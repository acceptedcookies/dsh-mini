/**
 * FxLocalRuntime —— 免登录内置 agent-runtime（fx-core.wasm 分包 + Asyncify 驱动）。
 * 实现 session-store 的 AgentRuntime 接口：把 ACP session/update 投影为 LocalEvent。
 * provider 经 dev-config（由 .local.development.json 生成，见 scripts/fx-dev-config.mjs）。
 */
import type { AcpClient, AcpPromptBlock, AcpUpdate } from './acp'
import { createAcpClient } from './acp'
import { guessMime } from '../vfs/api'
import { runFileTool } from '../vfs/tool-surface'
import type { FxRuntime as WasmRuntime, HostToolResult } from './fx-host'
import { createFxRuntime } from './fx-host'
import { createWxEnv } from './env'
import { resolveRoute } from './route'
import { loadDevConfig } from './dev'
import { createTicketProvider, hasFreshTicket, type TicketProvider } from './ticket'
import { markdownToHtml, plainText } from '../markdown'
import { storage } from '../storage'
import { randomId } from '../../utils/uuid'
import type {
  ApprovalOutcome,
  ChatItem,
  ImageRef,
  LocalEvent,
  QuestionAnswer,
  SessionSnapshot,
  SessionSummary,
} from '../../types/protocol'

const devConfig = loadDevConfig()

interface StoredSession {
  summary: SessionSummary
  cursor: number
  items: ChatItem[]
}

interface PendingPermission {
  approvalId: string
  sessionId: string
  allowOptionId: string | null
  resolve: (optionId: string | null) => void
}

interface TurnState {
  attemptId: string
  text: string
  thinking: string
  deltaIndex: number
  toolItemByCallId: Map<string, string>
}

const DEMO_TOOLS = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city (demo tool for fx wasm runtime)',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
]

/**
 * 五根 VFS 文件工具（services/vfs，rules/filesystem.md §6）。
 * 语义与 nano workspace lane 法同源：相对路径落 cwd=/data/{session}，
 * /mnt /backup /root/.profile /data/*\/artifacts 只读，五根外 unsafe-workspace-path。
 */
const FILE_TOOLS = [
  {
    name: 'file_read',
    description: 'Read a file from the workspace VFS. Paths: /data/<session>/ (your session cwd), /tmp/, /root/, /mnt/, /backup/. Relative paths resolve inside your session cwd.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer' },
        max_bytes: { type: 'integer' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description: 'Write text content to a workspace VFS file. Writable lanes: /data/<session>/, /tmp/, /root/.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_list',
    description: 'List directory entries in the workspace VFS (/ lists the five lane roots).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer' } },
      required: ['path'],
    },
  },
  {
    name: 'file_stat',
    description: 'Stat a path in the workspace VFS (exists/kind/size/content_hash/placement).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'file_remove',
    description: 'Remove a file from the workspace VFS (writable lanes only).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
]

const ALL_TOOLS = [...DEMO_TOOLS, ...FILE_TOOLS]

function executeDemoTool(name: string, input: unknown): HostToolResult {
  const args = (input ?? {}) as Record<string, unknown>
  if (name === 'get_weather') {
    return { content: JSON.stringify({ city: args.city, temp_c: 22, condition: 'sunny', source: 'dsh-mini-demo' }), isError: false }
  }
  return { content: `unknown tool ${name}`, isError: true }
}

/** file_* → services/vfs/tool-surface 共享层（T-O-8：fx 与 nano-mini host 同一实现源）。 */
export class FxLocalRuntime {
  private readonly sessions = new Map<string, StoredSession>()
  private readonly listeners = new Set<(event: LocalEvent) => void>()
  private readonly acpSessions = new Map<string, string>()
  private readonly turns = new Map<string, TurnState>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private wasm: WasmRuntime | undefined
  private client: AcpClient | undefined
  private ticket: TicketProvider | undefined
  private coreStarting: Promise<void> | undefined
  private coreFailed: Error | undefined
  /** 世代号：restartCore 递增，ensureCore 在途结果过期不落地（审查八轮 D4）。 */
  private coreGen = 0
  /** ensureCore 在途 wasm 实例——restartCore 可及以便 abort（此前实例逃逸不可达）。 */
  private startingWasm: WasmRuntime | undefined
  /** ensureCore 在途 client——init() 悬死时 restartCore 可 dispose 拒 pending（审查九轮 4c）。 */
  private startingClient: AcpClient | undefined
  /** 在飞轮次的 dsh session——host-import 工具调用无 sessionId 时的兜底作用域。 */
  private activeDshId: string | undefined

  constructor() {
    const saved = storage.getSessions<StoredSession>()
    if (saved !== undefined) {
      for (const s of saved) {
        // wasm 会话是进程内对象：重启后 running 状态不可恢复，归一为 idle
        if (s.summary.status === 'running') s.summary.status = 'idle'
        // 中断轮残留 running 工具卡归一 error+注记（与 kernel runtime 同构，UI 审查 F6）。
        let interrupted = false
        for (const item of s.items) {
          if (item.kind === 'tool_call' && item.status === 'running') {
            item.status = 'error'
            interrupted = true
          }
        }
        if (interrupted) {
          s.items.push({ kind: 'notice', id: randomId('notice'), seq: ++s.cursor, ts: Date.now(), level: 'warn', text: '（上一轮在工具执行中被中断）' })
        }
        this.sessions.set(s.summary.id, s)
      }
    }
  }

  static isUsable(): boolean {
    return devConfig !== undefined && typeof WXWebAssembly !== 'undefined'
  }

  subscribe(listener: (event: LocalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({ ...s.summary })).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  open(id: string): SessionSnapshot {
    const s = this.require(id)
    return { sessionId: id, cursor: s.cursor, status: s.summary.status, items: [...s.items], hasMore: false }
  }

  create(): SessionSummary {
    const now = Date.now()
    const summary: SessionSummary = {
      id: randomId('session'),
      title: '新会话',
      updatedAt: now,
      status: 'idle',
      lastMessage: '开始一个新的对话',
      messageCount: 0,
    }
    this.sessions.set(summary.id, { summary, cursor: 0, items: [] })
    this.persist()
    this.emit({ type: 'status', sessionId: summary.id, state: 'idle' })
    return { ...summary }
  }

  rename(id: string, title: string): SessionSummary {
    const s = this.require(id)
    s.summary.title = title
    s.summary.updatedAt = Date.now()
    this.persist()
    return { ...s.summary }
  }

  remove(id: string): void {
    // 在飞轮次先撤——删除不取消会让 acp turn 继续烧 llm，随后 require 抛错+
    // error emit 成幽灵横幅（与 kernel remove 同构，UI 审查 F5）。
    const acpId = this.acpSessions.get(id)
    if (acpId !== undefined && this.client !== undefined) this.client.cancel(acpId)
    // 该会话的未决 permission 以 null 收——否则 wasm 侧 request_permission 永挂
    // （cancel() 同构，删除即隐式全拒，审查八轮 D9）。
    this.resolveSessionApprovals(id)
    this.sessions.delete(id)
    this.acpSessions.delete(id)
    this.turnEpoch.delete(id)
    this.persist()
  }

  prompt(id: string, text: string, images: ImageRef[] = []): { messageId: string } {
    const s = this.require(id)
    if (s.summary.status === 'running') throw new Error('当前会话仍在运行')
    let blocks: AcpPromptBlock[]
    try {
      blocks = this.buildPromptBlocks(text, images)
    } catch (e) {
      // 抛出交给 store catch 上浮并恢复草稿——原 emit+空 messageId 被 store
      // 当成功吞掉用户输入（无转录行无横幅纯丢稿，UI 审查 F8）。
      throw e
    }
    s.summary.status = 'running'
    s.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId: id, state: 'running', step: 1 })
    const messageId = randomId('user')
    this.append(id, { kind: 'user_message', id: messageId, seq: this.nextSeq(s), text, images: images.length > 0 ? images : undefined })
    if (s.summary.title === '新会话' && text.trim().length > 0) s.summary.title = text.trim().slice(0, 28)
    this.persist()

    const epoch = (this.turnEpoch.get(id) ?? 0) + 1
    this.turnEpoch.set(id, epoch)
    void this.runTurn(id, blocks, epoch).catch((error) => {
      // 已删会话的迟到失败不发全局横幅（删除竞态，UI 审查 F5——与 kernel fail 同构）。
      if (this.sessions.get(id) === undefined) {
        console.warn(`[fx-runtime] turn_failed on deleted session ${id}:`, error instanceof Error ? error.message : error)
        return
      }
      s.summary.status = 'error'
      this.emit({ type: 'error', code: 'turn_failed', message: error instanceof Error ? error.message : 'turn 执行失败', retryable: true })
      this.emit({ type: 'status', sessionId: id, state: 'error' })
      this.persist()
    })
    return { messageId }
  }

  cancel(id: string): void {
    const s = this.require(id)
    const acpId = this.acpSessions.get(id)
    if (acpId !== undefined && this.client) this.client.cancel(acpId)
    // 世代递增使排队中旧轮在 dequeue 时失效（cancel 后重发的 prompt 是新一轮，
    // 不得被旧轮 status 检查误放行/误吞，审查十一轮 D11-1）。
    this.turnEpoch.set(id, (this.turnEpoch.get(id) ?? 0) + 1)
    this.resolveSessionApprovals(id)
    // cancel 无应答看守：session/cancel 是 fire-and-forget——wedged 核心不应答时
    // prompt pending 永不结算、turnChain 头阻塞拖死全会话队列（审查十一轮 D11-3）。
    // 超时不结算即 dispose 强拒在飞 pending，诚实落 turn_failed 而非永恒 running。
    if (acpId !== undefined) {
      setTimeout(() => {
        if (this.turns.has(acpId)) {
          console.warn(`[fx-runtime] 会话 ${acpId} 取消未应答——强制结算在飞 pending`)
          this.client?.dispose('会话取消后核心未应答——已强制结算该轮')
        }
      }, 20_000)
    }
    s.summary.status = 'idle'
    this.emit({ type: 'status', sessionId: id, state: 'idle' })
    this.emit({ type: 'error', code: 'cancelled', message: '已停止当前轮次', retryable: false })
    this.persist()
  }

  /** 未决 permission 以 null 收+approval.cancel 同步 UI 卡；id 缺席=全会话（审查九轮 D9a）。 */
  private resolveSessionApprovals(id?: string): void {
    for (const p of this.pendingPermissions.values()) {
      if (id === undefined || p.sessionId === id) {
        p.resolve(null)
        this.pendingPermissions.delete(p.approvalId)
        this.emit({ type: 'approval.cancel', approvalId: p.approvalId })
      }
    }
  }

  answerApproval(approvalId: string, outcome: ApprovalOutcome): void {
    const p = this.pendingPermissions.get(approvalId)
    if (p === undefined) return
    this.pendingPermissions.delete(approvalId)
    p.resolve(outcome === 'allowed-once' ? p.allowOptionId : null)
  }

  answerQuestion(_questionId: string, _answers: QuestionAnswer[]): void {
    // fx core 的 question 面未接（libfx hooks 未启用）。
  }

  clear(): void {
    this.sessions.clear()
    this.restartCore()
    storage.clearConversations()
  }

  /** 重启 wasm core（模型切换/注入变更后调用）：会话数据保留，acp 会话句柄作废。 */
  restartCore(): void {
    // 世代号递增——ensureCore 在途 IIFE 检出过期后不落地 stale-model 核（审查八轮 D4）。
    this.coreGen += 1
    this.acpSessions.clear()
    // 未决 permission 以 null 收（与 cancel 同构）——否则 wasm 侧 request_permission
    // 等答复永挂、turn 卡 running；dispose 拒绝 acp pending 使 client.prompt 的
    // await 被拒而非死等（wasm.abort 后响应永不至）。approval.cancel 同步收 UI 卡（审查九轮 D9a）。
    this.resolveSessionApprovals()
    this.client?.dispose('fx core 已重启')
    this.startingClient?.dispose('fx core 已重启')
    this.wasm?.abort()
    this.startingWasm?.abort()
    this.wasm = undefined
    this.startingWasm = undefined
    this.startingClient = undefined
    this.client = undefined
    this.coreStarting = undefined
    this.coreFailed = undefined
  }

  // ---- core 生命周期 ----

  private async ensureCore(): Promise<void> {
    if (this.client) return
    if (this.coreFailed) throw this.coreFailed
    if (this.coreStarting) return this.coreStarting
    if (devConfig === undefined) throw new Error('fx dev-config 缺失：先运行 node scripts/fx-dev-config.mjs')
    this.coreStarting = (async () => {
      // 世代在 IIFE 起点取样——首个 await 前的同步段与 restartCore 无交错，
      // 之后任一 restartCore 换代都会在落地前检出（审查八轮 D4）。
      const gen = this.coreGen
      const cfg = devConfig!
      const route = resolveRoute(cfg)
      const ticket = createTicketProvider(route, cfg)
      this.ticket = ticket
      // ready() 解析凭证来源：local=dev 直连；sim=注入记录优先/dev 兜底自动注入；cloud=必须用户注入。
      const source = await ticket.ready()
      // ready() 可达 challenge/SOTER 秒级——期间 restartCore 换代后 resume 写共享
      // 字段会覆盖新一代 starting* 注册使其资源不可达（审查十轮 D10-1）；抛错而
      // 非空 resolve——等待方须得到实拒而非走 client! TypeError（审查十轮 D10-4）。
      if (this.coreGen !== gen) throw new Error('fx core 已重启')
      const fxEnv = { ...cfg.fxEnv }
      // wasm provider 定义以生效源重建：cloudish 时 base_url 改写为数据面代理（wasm 无感，见 rules/topology-local.md §4）
      const baseUrl = route.proxyBaseUrl !== undefined ? `${route.proxyBaseUrl}/v1` : source.upstreamBaseUrl
      fxEnv.FX_PROVIDER = source.provider
      fxEnv.FX_MODEL = source.model
      fxEnv.FX_CONFIGURED_PROVIDERS = JSON.stringify({
        [source.provider]: {
          protocol: 'openai-chat-completions',
          base_url: baseUrl,
          auth: { type: 'none' },
          model_metadata: cfg.modelMeta,
        },
      })
      const env = createWxEnv()
      const rawFetch = env.fetch
      env.fetch = (url, init) =>
        ticket.authHeaders(url).then((headers) => rawFetch(url, { ...init, headers: { ...(init.headers ?? {}), ...headers } }))
      const wasm = createFxRuntime(env, {
        args: ['acp'],
        env: fxEnv,
        stderr: () => {},
        hostToolExecutor: (name, input, sid, _callId) => this.dispatchTool(name, input, sid),
      })
      this.startingWasm = wasm
      const client = createAcpClient(wasm, {
        tools: ALL_TOOLS,
        executeTool: async (name, input, _callId, sid) => this.dispatchTool(name, input, sid),
        onUpdate: (acpId, update) => this.onUpdate(acpId, update),
        onPermission: (params) => this.onPermission(params),
        onProtocolError: (e) => {
          this.emit({ type: 'error', code: 'protocol', message: `fx 协议异常: ${e.message}`, retryable: false })
        },
      })
      this.startingClient = client
      await wasm.start(devConfig!.wasmPath)
      await client.init()
      // 启动窗内 restartCore 已换代——stale-model 核不落地，abort 自收（审查八轮 D4）。
      // 清字段按同一引守卫——不得清掉新一代 IIFE 已注册的 starting*（审查十轮 D10-1）；
      // 抛错使全部等待方得到实拒（审查十轮 D10-4）。
      if (this.coreGen !== gen) {
        if (this.startingWasm === wasm) this.startingWasm = undefined
        if (this.startingClient === client) this.startingClient = undefined
        client.dispose('fx core 已重启')
        wasm.abort()
        throw new Error('fx core 已重启')
      }
      this.startingWasm = undefined
      this.startingClient = undefined
      this.wasm = wasm
      this.client = client
    })()
    const starting = this.coreStarting
    try {
      await starting
    } catch (e) {
      // 失败只在本代记账——restartCore 换代后迟到的旧 IIFE 拒绝不得毒化
      // 新一代（否则所有后续 ensureCore 永投旧错，审查九轮 4b）。
      if (this.coreStarting === starting) {
        this.coreFailed = e instanceof Error ? e : new Error(String(e))
      }
      throw e
    } finally {
      // settled 即清——stale-gen resolved 路径后 coreStarting 滞留会让下个
      // ensureCore 短路返回、client!.newSession TypeError 楔死车道（审查九轮 4a）。
      if (this.coreStarting === starting) this.coreStarting = undefined
    }
  }

  private async ensureAcpSession(dshId: string): Promise<string> {
    const known = this.acpSessions.get(dshId)
    if (known !== undefined) return known
    const acpId = await this.client!.newSession()
    this.acpSessions.set(dshId, acpId)
    return acpId
  }

  // ---- turn ----

  /** tool_call 分派：file_* → VFS（acpId→dshId 得 session 作用域）；其余 → demo。 */
  private dispatchTool(name: string, input: unknown, acpId: string | undefined): HostToolResult {
    if (name.startsWith('file_')) {
      const dshId = acpId !== undefined ? this.findDshId(acpId) : this.activeDshId
      if (dshId === undefined) return { content: JSON.stringify({ error: 'no-session', message: '无会话上下文' }), isError: true }
      return runFileTool(name, input, dshId)
    }
    return executeDemoTool(name, input)
  }

  /**
   * prompt blocks：images 先 text 后。fx 上限 8 张/6MB 合计/单张 20MB（客户端先记一笔账，
   * 同「读取前记账」纪律）。ImageRef.url 为本地临时路径，FSM base64 读出。
   */
  private buildPromptBlocks(text: string, images: ImageRef[]): AcpPromptBlock[] {
    const blocks: AcpPromptBlock[] = []
    if (images.length > 8) throw new Error('图片最多 8 张')
    let total = 0
    for (const image of images) {
      const fsm = wx.getFileSystemManager()
      const stat = fsm.statSync(image.url) as unknown as { size?: number }
      const size = Array.isArray(stat) ? 0 : stat.size ?? 0
      if (size > 20 * 1024 * 1024) throw new Error('单张图片超过 20MB')
      if (size === 0) throw new Error('图片为空或不可读')
      total += size
      if (total > 6 * 1024 * 1024) throw new Error('图片合计超过 6MB')
      const data = fsm.readFileSync(image.url, 'base64')
      if (typeof data !== 'string') throw new Error('图片读取失败')
      const mime = guessMime(image.url)
      blocks.push({ type: 'image', data, mimeType: mime !== undefined && mime.startsWith('image/') ? mime : 'image/png' })
    }
    blocks.push({ type: 'text', text })
    return blocks
  }

  /** 全局轮次互斥（审查十轮 D10-2）：fx_host_tool_call 不带 sessionId，
   *  dispatchTool 以 activeDshId 单槽兜底——并发轮次会互相改写 cwd 作用域，
   *  A 的文件工具读写进 B 的 /data/{sid}。串行排队是「单活动会话」注释语义
   *  的诚实执行；队列内取消/删除由入口处 status 检查兜底。 */
  private turnChain: Promise<void> = Promise.resolve()
  /** 按会话的轮次世代——cancel 使排队中旧轮失效（status 共享槽会被下一轮
   *  prompt 重置为 running，单查 status 会让已取消轮复活+新轮被静默丢弃，
   *  审查十一轮 D11-1）。 */
  private readonly turnEpoch = new Map<string, number>()

  private runTurn(dshId: string, blocks: AcpPromptBlock[], epoch: number): Promise<void> {
    const run = this.turnChain.then(() => {
      const s = this.sessions.get(dshId)
      if (s === undefined || s.summary.status !== 'running' || this.turnEpoch.get(dshId) !== epoch) return
      return this.runTurnInner(dshId, blocks)
    })
    this.turnChain = run.catch(() => { /* 单轮失败不断链 */ })
    return run
  }

  private async runTurnInner(dshId: string, blocks: AcpPromptBlock[]): Promise<void> {
    const s = this.require(dshId)
    await this.ensureCore()
    // 票据过期重铸：core 常驻跨多轮，ensureCore 只在首轮铸票——票据 ~30min TTL
    // 过期后 env.fetch 的 authHeaders 永久空头上行=每轮 401 死锁（审查三轮 N2）。
    // runTurn=用户手势上下文，ready() 允许 SOTER；local 车道 ready() 为纯解析零成本。
    if (this.ticket !== undefined && !hasFreshTicket()) await this.ticket.ready()
    // ready() 重铸可达 challenge/SOTER 秒级——窗内 restartCore 清 client 后
    // 直进 ensureAcpSession 会撞 client!.newSession TypeError（审查十一轮 D11-2）。
    if (this.client === undefined) throw new Error('fx core 已重启')
    const acpId = await this.ensureAcpSession(dshId)
    const turn: TurnState = { attemptId: randomId('attempt'), text: '', thinking: '', deltaIndex: 0, toolItemByCallId: new Map() }
    this.turns.set(acpId, turn)
    // wasm host-import 通道（fx_host_tool_call）不带 sessionId——单活动会话下以在飞轮次兜底。
    this.activeDshId = dshId
    try {
      await this.client!.prompt(acpId, blocks)
    } finally {
      this.turns.delete(acpId)
      this.activeDshId = undefined
      // 轮失败/中止在 request_permission 悬于未答时——轮终即该请求永不可答，
      // 连 UI 卡以 null+cancel 收（审查十一轮 D11-4）。
      this.resolveSessionApprovals(dshId)
    }
    const item: ChatItem = {
      kind: 'assistant_message',
      id: randomId('msg'),
      seq: this.nextSeq(s),
      text: turn.text,
      html: markdownToHtml(turn.text),
      thinking: turn.thinking || undefined,
    }
    this.append(dshId, item)
    s.summary.status = 'idle'
    s.summary.updatedAt = Date.now()
    this.emit({ type: 'assistant.settle', sessionId: dshId, seq: item.seq, messageId: item.id })
    this.emit({ type: 'status', sessionId: dshId, state: 'idle' })
    this.persist()
  }

  private onUpdate(acpId: string, update: AcpUpdate): void {
    const dshId = this.findDshId(acpId)
    if (dshId === undefined) return
    const turn = this.turns.get(acpId)
    const kind = update.sessionUpdate
    if (kind === 'agent_message_chunk') {
      const text = (update.content as { text?: string } | undefined)?.text
      if (typeof text !== 'string' || text.length === 0) return
      const index = turn ? turn.deltaIndex++ : 0
      if (turn) turn.text += text
      this.emit({ type: 'assistant.delta', sessionId: dshId, attemptId: turn?.attemptId ?? 'unknown', index, text })
      return
    }
    if (kind === 'agent_thought_chunk' && turn) {
      const text = (update.content as { text?: string } | undefined)?.text
      if (typeof text === 'string') turn.thinking += text
      return
    }
    if (kind === 'tool_call' && typeof update.toolCallId === 'string') {
      const s = this.require(dshId)
      const name = typeof update.name === 'string' && update.name.length > 0 ? update.name : 'tool_call'
      const args = update.rawInput !== undefined ? truncate(JSON.stringify(update.rawInput)) : undefined
      const item: ChatItem = {
        kind: 'tool_call',
        id: randomId('tool'),
        seq: this.nextSeq(s),
        tool: name,
        status: 'running',
        title: typeof update.title === 'string' ? update.title : name,
        callId: update.toolCallId,
        detail: args,
        args,
      }
      turn?.toolItemByCallId.set(update.toolCallId, item.id)
      this.append(dshId, item)
      return
    }
    if (kind === 'tool_call_update' && typeof update.toolCallId === 'string') {
      const s = this.require(dshId)
      const itemId = turn?.toolItemByCallId.get(update.toolCallId)
      const status = update.status === 'completed' ? 'ok' : update.status === 'failed' ? 'error' : 'running'
      const out = extractToolOutput(update)
      if (itemId !== undefined) {
        const current = s.items.find((i) => i.id === itemId)
        if (current?.kind === 'tool_call') {
          this.replace(dshId, { ...current, status, detail: out !== undefined ? truncate(out) : current.detail })
        }
      }
      if (status !== 'running' && out !== undefined) {
        const toolItem = itemId !== undefined ? s.items.find((i) => i.id === itemId) : undefined
        this.append(dshId, {
          kind: 'tool_result',
          id: randomId('result'),
          seq: this.nextSeq(s),
          tool: toolItem?.kind === 'tool_call' ? toolItem.tool : 'tool_call',
          status,
          summary: truncate(out.split('\n')[0] || out, 120),
          detail: truncate(out),
        })
      }
      return
    }
  }

  private onPermission(params: unknown): Promise<string | null> {
    const p = params as { sessionId?: string; toolCall?: { title?: string }; options?: Array<{ optionId: string; kind?: string; name?: string }> }
    const acpId = typeof p.sessionId === 'string' ? p.sessionId : ''
    const dshId = this.findDshId(acpId)
    if (dshId === undefined) return Promise.resolve(null)
    const allow = (p.options ?? []).find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
    const approvalId = randomId('approval')
    return new Promise<string | null>((resolve) => {
      this.pendingPermissions.set(approvalId, { approvalId, sessionId: dshId, allowOptionId: allow?.optionId ?? null, resolve })
      this.emit({
        type: 'approval.request',
        approval: {
          id: approvalId,
          sessionId: dshId,
          toolName: p.toolCall?.title ?? 'tool',
          reason: 'fx runtime 请求执行许可',
          createdAt: Date.now(),
        },
      })
    })
  }

  private findDshId(acpId: string): string | undefined {
    for (const [dsh, acp] of this.acpSessions) if (acp === acpId) return dsh
    return undefined
  }

  // ---- 存储与事件 ----

  private require(id: string): StoredSession {
    const s = this.sessions.get(id)
    if (s === undefined) throw new Error('会话不存在')
    return s
  }

  private nextSeq(s: StoredSession): number {
    s.cursor += 1
    return s.cursor
  }

  private append(sessionId: string, item: ChatItem): void {
    const s = this.require(sessionId)
    const stamped: ChatItem = item.ts === undefined ? ({ ...item, ts: Date.now() } as ChatItem) : item
    s.items.push(stamped)
    s.summary.updatedAt = Date.now()
    s.summary.messageCount = s.items.length
    if (stamped.kind === 'assistant_message') s.summary.lastMessage = plainText(stamped.text)
    else if (stamped.kind === 'user_message') s.summary.lastMessage = stamped.text
    this.persist()
    this.emit({ type: 'item.append', sessionId, seq: stamped.seq, item: stamped })
  }

  private replace(sessionId: string, item: ChatItem): void {
    const s = this.require(sessionId)
    const index = s.items.findIndex((c) => c.id === item.id)
    const previous = index === -1 ? undefined : s.items[index]
    const stamped: ChatItem = item.ts === undefined
      ? ({ ...item, ts: previous?.ts ?? Date.now() } as ChatItem)
      : item
    if (index !== -1) s.items[index] = stamped
    s.summary.updatedAt = Date.now()
    this.persist()
    this.emit({ type: 'item.replace', sessionId, seq: stamped.seq, item: stamped })
  }

  private persist(): void {
    storage.setSessions([...this.sessions.values()])
  }

  private emit(event: LocalEvent): void {
    // 单监听器抛错不得波及其余订阅方或中断轮次状态（与 kernel runtime 同构，审查四轮 F9）。
    for (const listener of this.listeners) {
      try { listener(event) } catch (e) { console.warn('[fx-runtime] listener 抛错:', e instanceof Error ? e.message : e) }
    }
  }
}

function stringifyResult(output: unknown): string {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

/** tool_call_update.content = [{type:'content', content:{type:'text',text}}] → 纯文本 */
function extractToolOutput(update: AcpUpdate): string | undefined {
  if (update.rawOutput !== undefined) return stringifyResult(update.rawOutput)
  if (Array.isArray(update.content)) {
    const parts = update.content
      .map((c) => (c as { content?: { text?: string } })?.content?.text)
      .filter((t): t is string => typeof t === 'string')
    if (parts.length > 0) return parts.join('')
  }
  return undefined
}

function truncate(s: string, max = 500): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export const fxRuntime = new FxLocalRuntime()
