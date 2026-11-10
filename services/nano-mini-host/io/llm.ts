/**
 * io.llm mp 侧实现：wx.request → BYOK proxy 车道（T-O-8）。
 * 复用 services/fx/ticket.ts 票据车道（sim/真云同构）：cloudish 时
 * Authorization=Bearer ticket；local 模式走 dev-config 直连上游。
 * 首版非流式 JSON（仓内无 TS 侧 SSE 解析器；需流式则本文件内新写）。
 */

import { createTicketProvider, hasFreshTicket, providerMintsTicket } from '../../fx/ticket'
import { loadDevConfig, currentRoute } from '../../fx/dev'
import { routeDefaultEngine } from '../../session-engine'
import type { SessionEngine } from '../../../types/protocol'
import { readEnrollment, activeModel } from '../../fx/enrollment'
import { defaultModelFor, modelsForEngine } from '../../config'
import { isContainerUrl, callContainer, parseContainerUrl } from '../../fx/container'
import { storage } from '../../storage'
import type { LlmChunk } from '../types'
import { loadKernel } from '../kernel-loader'
import type { AssembledContext } from '../../context/assemble'

async function wxRequestJson(url: string, headers: Record<string, string>, data: unknown): Promise<{ status: number; body: unknown }> {
  // 容器车道：container://{service} → callContainer 内网直连（route.ts 判定）。
  // 传输层失败（env 错配/服务不可达）时回退公网 proxy_url；业务错误以 status 透传不回退。
  if (isContainerUrl(url)) {
    const cloud = loadDevConfig()?.cloud
    const envId = cloud?.envId ?? ''
    try {
      return await callContainer(cloud?.containerEnvId || envId, envId, url, { method: 'POST', headers, body: data })
    } catch (e) {
      const pub = cloud?.proxyUrl
      if (pub === undefined || pub.length === 0) throw e
      console.warn(`[io.llm] callContainer 失败，回退公网 proxy: ${e instanceof Error ? e.message : String(e)}`)
      url = pub + parseContainerUrl(url).path
    }
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      header: headers,
      data: data as Record<string, unknown>,
      timeout: 60000,
      success: (res) => resolve({ status: res.statusCode, body: res.data }),
      fail: (err) => reject(new Error(`${err.errMsg ?? 'wx.request failed'} · ${url}`)),
    })
  })
}

export interface IoLlmDeps {
  /** 测试注入：替换 wx.request 通道（Node harness / 单测用）。 */
  request?: (url: string, headers: Record<string, string>, data: unknown) => Promise<{ status: number; body: unknown }>
  /** 后台车道（sweep/tick）：铸票车道路由下无活票即抛 ticket-required——
   *  ready() 会走 bio 证明（SOTER 须用户手势上下文），后台不得触发（审查五轮 F6）。 */
  noMint?: boolean
  /** 会话引擎戳记（MN03）：'magpie'→本地直连车道；缺席→路由兜底派生，
   *  与无戳旧会话原语义一致（route.mode local→magpie / cloudish→nano-agent）。 */
  engine?: SessionEngine
}

function apiBase(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function bearer(headers: Record<string, string>): string {
  const value = headers.Authorization ?? headers.authorization ?? ''
  return value.replace(/^Bearer\s+/i, '')
}

export function createIoLlm(deps: IoLlmDeps = {}): (context: AssembledContext) => AsyncIterable<LlmChunk> {
  const request = deps.request ?? wxRequestJson
  return async function* (context: AssembledContext): AsyncIterable<LlmChunk> {
    const cfg = loadDevConfig()
    const route = currentRoute()
    // 引擎裁决先于路由：戳记会话走自己的车道，不随全局旋钮漂移。
    const engine = deps.engine ?? routeDefaultEngine()
    const enrollment = readEnrollment()
    // 生效模型=设置页选择（白名单内归一化），enrollment.model 仅登记信息（resolveSource 同合同）；
    // 此前顺序颠倒导致设置页选模型静默失效（审查 B8）。cfg 缺席（生产云车道）时：
    // 设置页白名单内显式选择仍优先；无有效选择才回退 enrollment.model（BYOK 车道登记值）。
    const picked = storage.getModel()
    // 引擎面白名单（MN04）：BYOK 车道只收 BYOK id，magpie 会话只收 workbuddy id——
    // 跨引擎的全局选择在错误车道上必然被上游白名单拒绝，这里就地归一。
    const lane = modelsForEngine(engine)
    const model = cfg !== undefined
      ? activeModel(cfg)
      : picked !== undefined && lane.some((m) => m.id === picked)
        ? picked
        : enrollment?.model !== undefined && lane.some((m) => m.id === enrollment.model)
          ? enrollment.model
          : defaultModelFor(engine)

    // upstreamBaseUrl 形态两侧不一致：dev-config 生成物自带 /v1 尾，enroll 记录
    // 与裸 baseUrl 不带——统一归一（/vN 尾不再拼 v1），否则 /v1/v1/... 真 404
    // （MN03-B9 实证：kernel lane 对真 dev-config 从未可达，stub 恰好绕过）。
    let baseUrl = ''
    let apiKey = ''
    if (engine === 'magpie') {
      const upstream = cfg?.upstreamBaseUrl ?? cfg?.baseUrl ?? ''
      if (upstream.length === 0) throw new Error('io.llm: local 模式缺少 upstreamBaseUrl')
      baseUrl = apiBase(upstream)
      apiKey = cfg?.providerApiKey ?? ''
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
      // 后台车道（noMint）：LocalTicketProvider 不铸票直接放行；铸票车道
      // 无活票时 ready() 会弹 SOTER——抛 ticket-required 让 pump-error→重臂（F6）。
      if (deps.noMint === true && providerMintsTicket(route) && !hasFreshTicket()) {
        throw new Error('io.llm: ticket-required（后台车道无活票不铸票）')
      }
      const resolved = await ticket.ready()
      baseUrl = apiBase(route.proxyBaseUrl ?? resolved.upstreamBaseUrl)
      const headers = await ticket.authHeaders(`${baseUrl}/responses`)
      apiKey = bearer(headers)
    }

    const kernel = loadKernel() as {
      measureWireRequest?: (request: unknown) => unknown
      preflightWireRequest?: (request: unknown) => { ok: boolean; reason?: string; whole_cap?: number }
      dispatchSingleWire?: (input: unknown) => Promise<{
        kind: string
        reason?: string
        events?: ReadonlyArray<{ kind: string; payload: unknown }>
        usage?: { inputTokens: number | null; outputTokens: number | null }
      }>
    } | undefined
    if (typeof kernel?.measureWireRequest !== 'function'
      || typeof kernel.preflightWireRequest !== 'function'
      || typeof kernel.dispatchSingleWire !== 'function') {
      yield { kind: 'error', message: 'kernel wire surface unavailable' }
      return
    }
    const wireRequest = {
      messages: context.messages,
      tools: context.tools,
      base_url: baseUrl,
    }
    kernel.measureWireRequest(wireRequest)
    const bounds = kernel.preflightWireRequest(wireRequest)
    if (!bounds.ok || typeof bounds.whole_cap !== 'number') {
      yield { kind: 'error', message: bounds.reason ?? 'request-bounds:rejected' }
      return
    }
    const outcome = await kernel.dispatchSingleWire({
      kind: 'http-responses',
      providerKey: 'deepseek',
      modelId: model,
      request: wireRequest,
      credential: { ok: true, kind: 'bearer', apiKey, alias: 'host' },
      transport: {
        fetch: async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
          const data = typeof init.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : {}
          const res = await request(url, { ...(init.headers ?? {}), 'content-type': 'application/json' }, data)
          const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? null)
          const bytes = new TextEncoder().encode(text)
          let sent = false
          return {
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            body: {
              getReader: () => ({
                read: async () => sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes }),
                releaseLock: () => {},
                cancel: async () => {},
              }),
              cancel: async () => {},
            },
          }
        },
      },
      bodyCap: bounds.whole_cap,
      requestCap: bounds.whole_cap,
      deadlines: { totalMs: 60000, wireMs: 60000, resultMs: 60000 },
    })
    if (outcome.kind !== 'terminal-known') {
      yield { kind: 'error', message: outcome.reason ?? outcome.kind }
      return
    }
    for (const event of outcome.events ?? []) {
      if (event.kind === 'text' && typeof event.payload === 'string') {
        yield { kind: 'content', text: event.payload }
      } else if (event.kind === 'tool-call' && event.payload !== null && typeof event.payload === 'object') {
        const payload = event.payload as { id?: unknown; name?: unknown; arguments?: unknown }
        if (typeof payload.id !== 'string' || typeof payload.name !== 'string' || typeof payload.arguments !== 'string') continue
        let input: unknown = payload.arguments
        try { input = JSON.parse(payload.arguments) } catch { /* 上游参数保持原文字 */ }
        yield { kind: 'tool_call', call: { id: payload.id, name: payload.name, input } }
      } else if (event.kind === 'error') {
        yield { kind: 'error', message: JSON.stringify(event.payload) }
      }
    }
    const usage = outcome.usage
    if (usage && (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number')) {
      yield {
        kind: 'usage',
        usage: {
          ...(typeof usage.inputTokens === 'number' ? { inputTokens: usage.inputTokens } : {}),
          ...(typeof usage.outputTokens === 'number' ? { outputTokens: usage.outputTokens } : {}),
        },
      }
    }
    yield { kind: 'done' }
  }
}
