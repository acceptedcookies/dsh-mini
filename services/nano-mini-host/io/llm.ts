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
import type { LlmOutput, LlmToolCall } from '../types'

interface ChatMessage {
  role: string
  content?: string | null | Array<Record<string, unknown>>
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  [key: string]: unknown
}

function normalizeMessages(messages: unknown[]): ChatMessage[] {
  // kernel turn.messages 真实形状（reducer.ts:189-298）：
  //   assistant: {role:'assistant', content:[{kind:'text'}|{kind:'tool_call',id,name,arguments}]}
  //   tool:      {role:'tool', toolCallId, content}
  // 必须映射 OpenAI 合同：tool_call part→tool_calls[]；toolCallId→tool_call_id（审查 F5）
  const out: ChatMessage[] = []
  for (const m of messages) {
    const row = (m ?? {}) as Record<string, unknown>
    const role = typeof row.role === 'string' ? row.role : 'user'
    if (role === 'tool' || row.toolCallId !== undefined) {
      out.push({
        role: 'tool',
        tool_call_id: (row.toolCallId ?? row.tool_call_id) as string,
        content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content ?? ''),
      })
      continue
    }
    if (Array.isArray(row.content)) {
      const texts: string[] = []
      const images: Array<Record<string, unknown>> = []
      const toolCalls: NonNullable<ChatMessage['tool_calls']> = []
      for (const part of row.content as Array<Record<string, unknown>>) {
        if (part?.kind === 'text' && typeof part.text === 'string') texts.push(part.text)
        else if (part?.kind === 'image_url' && typeof part.url === 'string') {
          // kernel part → OpenAI image_url 块（G4）：images 先 text 后（fx 约定）
          images.push({ type: 'image_url', image_url: { url: part.url } })
        }
        else if (part?.kind === 'tool_call') {
          toolCalls.push({
            id: String(part.id ?? ''),
            type: 'function',
            function: { name: String(part.name ?? ''), arguments: typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments ?? {}) },
          })
        }
      }
      const msg: ChatMessage = { role, content: texts.join('\n') || null }
      if (images.length > 0) {
        msg.content = [...images, ...texts.map((t) => ({ type: 'text', text: t }))]
      }
      if (toolCalls.length > 0) msg.tool_calls = toolCalls
      out.push(msg)
      continue
    }
    const content = row.content ?? row.text ?? null
    out.push({ role, content: typeof content === 'string' ? content : JSON.stringify(content) })
  }
  return out
}

/** OpenAI usage {prompt_tokens,completion_tokens} → kernel {inputTokens,outputTokens}（F5 修复 NaN）。
 *  双侧缺失时 ?? 0——undefined 参与 reducer 累加会产 NaN 并随 checkpoint 持久化（审查十四轮 L1）。 */
function normalizeUsage(u: unknown): LlmOutput['usage'] {
  const r = (u ?? {}) as Record<string, unknown>
  return {
    inputTokens: (r.prompt_tokens ?? r.inputTokens ?? 0) as number | undefined,
    outputTokens: (r.completion_tokens ?? r.outputTokens ?? 0) as number | undefined,
  }
}

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

/** file_* 工具面广告（T-O-4 与 io.tool/runFileTool 分发面同源命名）：
 *  OpenAI tools 字段是唯一让模型产出 tool_calls 的通道——此前请求从未携带，
 *  真机轮次退化为纯文本闲聊（模型把 vfs 当成 Linux 内核概念自由发挥）。 */
const FILE_TOOL_ENVELOPE = [
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: '读取会话 VFS 内文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'VFS 绝对路径' },
          offset: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: '写入（创建或覆盖）会话 VFS 内文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'VFS 绝对路径' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_list',
      description: '列出会话 VFS 目录条目',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'VFS 目录路径' },
          cursor: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_stat',
      description: '查询会话 VFS 路径元信息（大小/版本/类型）',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'VFS 绝对路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_remove',
      description: '删除会话 VFS 内文件',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'VFS 绝对路径' } },
        required: ['path'],
      },
    },
  },
] as const

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

export function createIoLlm(deps: IoLlmDeps = {}): (messages: unknown[]) => Promise<LlmOutput> {
  const request = deps.request ?? wxRequestJson
  return async (messages: unknown[]): Promise<LlmOutput> => {
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
    const chatUrl = (base: string): string => {
      const b = base.replace(/\/+$/, '')
      return `${/\/v\d+$/i.test(b) ? b : `${b}/v1`}/chat/completions`
    }

    let url = ''
    let headers: Record<string, string> = { 'content-type': 'application/json' }
    if (engine === 'magpie') {
      // magpie 引擎：本地直连 dev 车道——无代理票据，命中 upstream + dev key
      const upstream = cfg?.upstreamBaseUrl ?? cfg?.baseUrl ?? ''
      if (upstream.length === 0) throw new Error('io.llm: local 模式缺少 upstreamBaseUrl')
      url = chatUrl(upstream)
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
      // 后台车道（noMint）：LocalTicketProvider 不铸票直接放行；铸票车道
      // 无活票时 ready() 会弹 SOTER——抛 ticket-required 让 pump-error→重臂（F6）。
      if (deps.noMint === true && providerMintsTicket(route) && !hasFreshTicket()) {
        throw new Error('io.llm: ticket-required（后台车道无活票不铸票）')
      }
      const resolved = await ticket.ready()
      const base = route.proxyBaseUrl ?? resolved.upstreamBaseUrl
      url = chatUrl(base)
      headers = { ...headers, ...(await ticket.authHeaders(url)) }
    }

    const res = await request(url, headers, {
      model,
      messages: normalizeMessages(messages),
      tools: FILE_TOOL_ENVELOPE,
      stream: false,
    })
    if (res.status !== 200) {
      throw new Error(`io.llm upstream ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
    }
    const body = res.body as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatMessage['tool_calls'] } }>; usage?: LlmOutput['usage'] }
    const msg = body.choices?.[0]?.message
    const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
      // 缺 id 的 tool_calls（部分上游方言）合成稳定 id——undefined id 会让
      // kernel tool_result 配对落空、步决策误判（审查十四轮 L6）。
      id: tc.id ?? `call_synth_${i}`,
      name: tc.function.name,
      input: safeParse(tc.function.arguments),
    }))
    return {
      text: msg?.content ?? null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: normalizeUsage(body.usage),
    }
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
