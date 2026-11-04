/** 最小 ACP+libfx 客户端：initialize → libfx/new → session/prompt + 控制请求应答。 */
import type { FxRuntime } from './fx-host'
import { TextDecoderImpl, TextEncoderImpl } from './utf8'

export interface AcpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  providerExecuted?: boolean
}
export interface AcpToolResult {
  content: string
  isError?: boolean
  rich?: boolean
}
export interface AcpUpdate {
  sessionUpdate?: string
  /** agent_message_chunk: {type:'text',text}; tool_call_update: content 数组。 */
  content?: unknown
  toolCallId?: string
  /** 工具名（tool_call update 上）。 */
  name?: string
  /** 阶段展示标签（如 "Running"），非工具名。 */
  title?: string
  status?: string
  kind?: string
  rawInput?: unknown
  rawOutput?: unknown
  [k: string]: unknown
}
interface AcpMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: Record<string, unknown> & { sessionId?: string; name?: string; input?: unknown; toolCallId?: string; update?: AcpUpdate }
  result?: Record<string, unknown> & { sessionId?: string; stopReason?: string }
  error?: { code?: number; message?: string; data?: unknown }
}
/** session/prompt 内容块：标准 ACP text/image（image 为内联 base64 data）。 */
export interface AcpPromptBlock {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}
export interface AcpClientOptions {
  encoder?: { encode(s: string): Uint8Array }
  decoder?: { decode(b: Uint8Array): string }
  tools?: AcpToolDescriptor[]
  executeTool?: (name: string, input: unknown, toolCallId: string | undefined, sessionId: string | undefined) => Promise<AcpToolResult>
  onUpdate?: (sessionId: string, update: AcpUpdate) => void
  onPermission?: (params: unknown) => Promise<string | null>
  onProtocolError?: (error: Error, line: Uint8Array) => void
}
export interface AcpClient {
  init(): Promise<void>
  newSession(requestedId?: string): Promise<string>
  prompt(sessionId: string, blocks: AcpPromptBlock[]): Promise<{ stopReason?: string }>
  cancel(sessionId: string): void
}

export function createAcpClient(runtime: FxRuntime, options: AcpClientOptions): AcpClient {
  const encoder = options.encoder ?? new TextEncoderImpl()
  const decoder = options.decoder ?? new TextDecoderImpl()
  const pending = new Map<number | string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let nextId = 1
  let buf = new Uint8Array()

  const send = (msg: AcpMessage) => runtime.write(encoder.encode(JSON.stringify(msg) + '\n'))
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params: params as AcpMessage['params'] })
    })

  async function handleMessage(msg: AcpMessage): Promise<void> {
    if (msg.id !== undefined && msg.method === undefined) {
      const w = pending.get(msg.id)
      if (!w) return
      pending.delete(msg.id)
      if (msg.error) {
        const e = new Error(msg.error.message)
        ;(e as Error & { data?: unknown }).data = msg.error.data
        w.reject(e)
      } else w.resolve(msg.result)
      return
    }
    if (msg.method === 'session/update') {
      const sid = msg.params?.sessionId
      if (typeof sid === 'string' && msg.params?.update) options.onUpdate?.(sid, msg.params.update)
      return
    }
    if (msg.method === 'libfx/tool_call') {
      try {
        const res = await options.executeTool!(
          msg.params?.name as string,
          msg.params?.input,
          msg.params?.toolCallId as string | undefined,
          msg.params?.sessionId as string | undefined,
        )
        send({ jsonrpc: '2.0', id: msg.id, result: { content: res.content, isError: !!res.isError, ...(res.rich ? { contentType: 'rich' } : {}) } as AcpMessage['result'] })
      } catch (e) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String((e as Error)?.message || e) } })
      }
      return
    }
    if (msg.method === 'session/request_permission') {
      let optionId: string | null = null
      try {
        optionId = (await options.onPermission?.(msg.params)) ?? null
      } catch {
        /* noop */
      }
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } },
      } as AcpMessage)
      return
    }
    if (msg.method === 'libfx/journal_flush') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
      return
    }
  }

  runtime.setStdoutHandler((chunk: Uint8Array) => {
    const next = new Uint8Array(buf.length + chunk.length)
    next.set(buf)
    next.set(chunk, buf.length)
    buf = next
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 10) continue
      const line = buf.subarray(start, i)
      start = i + 1
      if (!line.length) continue
      try {
        void handleMessage(JSON.parse(decoder.decode(line)) as AcpMessage)
      } catch (e) {
        options.onProtocolError?.(e as Error, line)
      }
    }
    buf = buf.subarray(start)
  })

  return {
    async init(): Promise<void> {
      await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { libfx: { tools: options.tools || [] } },
      })
    },
    async newSession(requestedId?: string): Promise<string> {
      const r = (await request('libfx/new', requestedId === undefined ? {} : { sessionId: requestedId })) as { sessionId: string }
      return r.sessionId
    },
    prompt(sessionId: string, blocks: AcpPromptBlock[]) {
      return request('session/prompt', { sessionId, prompt: blocks })
    },
    cancel(sessionId: string) {
      send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    },
  }
}
