/**
 * io.llm mp 侧实现：wx.request → BYOK proxy 车道（T-O-8）。
 * 复用 services/fx/ticket.ts 票据车道（sim/真云同构）：cloudish 时
 * Authorization=Bearer ticket；local 模式走 dev-config 直连上游。
 * 首版非流式 JSON（仓内无 TS 侧 SSE 解析器；需流式则本文件内新写）。
 */

import { createTicketProvider } from '../../fx/ticket'
import { loadDevConfig, currentRoute } from '../../fx/dev'
import { readEnrollment } from '../../fx/enrollment'
import { storage } from '../../storage'
import type { LlmOutput, LlmToolCall } from '../types'

interface ChatMessage {
  role: string
  content?: string | null
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  [key: string]: unknown
}

function normalizeMessages(messages: unknown[]): ChatMessage[] {
  // kernel turn.messages 元素形状由 kernel 管；此处做宽容映射成 OpenAI 消息
  return messages.map((m) => {
    const row = (m ?? {}) as Record<string, unknown>
    const role = typeof row.role === 'string' ? row.role : 'user'
    const content = row.content ?? row.text ?? null
    const out: ChatMessage = { role, content: typeof content === 'string' ? content : JSON.stringify(content) }
    return out
  })
}

function wxRequestJson(url: string, headers: Record<string, string>, data: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      header: headers,
      data: data as Record<string, unknown>,
      timeout: 60000,
      success: (res) => resolve({ status: res.statusCode, body: res.data }),
      fail: (err) => reject(new Error(err.errMsg ?? 'wx.request failed')),
    })
  })
}

export interface IoLlmDeps {
  /** 测试注入：替换 wx.request 通道（Node harness / 单测用）。 */
  request?: (url: string, headers: Record<string, string>, data: unknown) => Promise<{ status: number; body: unknown }>
}

export function createIoLlm(deps: IoLlmDeps = {}): (messages: unknown[]) => Promise<LlmOutput> {
  const request = deps.request ?? wxRequestJson
  return async (messages: unknown[]): Promise<LlmOutput> => {
    const cfg = loadDevConfig()
    const route = currentRoute()
    const enrollment = readEnrollment()
    const model = enrollment?.model ?? storage.getModel() ?? cfg?.model ?? 'unknown'

    let url = ''
    let headers: Record<string, string> = { 'content-type': 'application/json' }
    if (route.mode === 'local') {
      // 本地直连（dev 车道）：无代理票据，命中 upstream + dev key
      const upstream = cfg?.upstreamBaseUrl ?? cfg?.baseUrl ?? ''
      if (upstream.length === 0) throw new Error('io.llm: local 模式缺少 upstreamBaseUrl')
      url = `${upstream.replace(/\/$/, '')}/v1/chat/completions`
      if (cfg?.providerApiKey !== undefined && cfg.providerApiKey.length > 0) {
        headers = { ...headers, Authorization: `Bearer ${cfg.providerApiKey}` }
      }
    } else {
      // cloudish：proxy 车道 + 票据注入（凭证只住 proxy 边界，T-O-8）
      // TicketSource 形状从 dev-config + enroll 记录拼出（dev-config 缺失时用 enrollment 兜底）
      const source = {
        providerName: cfg?.providerName ?? enrollment?.provider ?? 'byok',
        upstreamBaseUrl: cfg?.upstreamBaseUrl ?? enrollment?.upstreamBaseUrl ?? '',
        providerApiKey: cfg?.providerApiKey ?? '',
        model,
        allowedModels: cfg?.allowedModels,
        sim: cfg?.sim ?? { baseUrl: route.simBaseUrl ?? 'http://127.0.0.1:3426' },
        cloud: cfg?.cloud ?? { envId: route.cloudEnvId ?? '', proxyUrl: route.proxyBaseUrl ?? '' },
      }
      const ticket = createTicketProvider(route, source)
      const resolved = await ticket.ready()
      const base = route.proxyBaseUrl ?? resolved.upstreamBaseUrl
      url = `${base.replace(/\/$/, '')}/v1/chat/completions`
      headers = { ...headers, ...(await ticket.authHeaders(url)) }
    }

    const res = await request(url, headers, {
      model,
      messages: normalizeMessages(messages),
      stream: false,
    })
    if (res.status !== 200) {
      throw new Error(`io.llm upstream ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
    }
    const body = res.body as { choices?: Array<{ message?: ChatMessage }>; usage?: LlmOutput['usage'] }
    const msg = body.choices?.[0]?.message
    const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: safeParse(tc.function.arguments),
    }))
    return {
      text: msg?.content ?? null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: body.usage,
    }
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
