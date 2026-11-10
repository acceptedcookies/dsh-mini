/**
 * FxLocalRuntime —— 免登录内置 agent-runtime（fx-core.wasm 分包 + Asyncify 驱动）。
 * 实现 session-store 的 AgentRuntime 接口：把 ACP session/update 投影为 LocalEvent。
 * provider 经 dev-config（由 .local.development.json 生成，见 scripts/fx-dev-config.mjs）。
 */
import type { AcpClient, AcpPromptBlock, AcpUpdate } from './acp'
import { createAcpClient } from './acp'
import { guessMime } from '../vfs/api'
import { loadKernel } from '../nano-mini-host/kernel-loader'
import { canonicalAcpTools, isBashKernel, runCanonicalTool } from '../nano-mini-host/io/bash-exec'
import { toCanonical as fxToCanonical } from '../nacp/adapters/fx'
import { settleHostApproval } from '../nano-mini-host/io/approval-gate'
import { derive } from '../nacp/derive'
import type { FxRuntime as WasmRuntime, HostToolResult } from './fx-host'
import { createFxRuntime } from './fx-host'
import { createWxEnv } from './env'
import { resolveRoute } from './route'
import { loadDevConfig } from './dev'
import { createTicketProvider, hasFreshTicket, type TicketProvider } from './ticket'
import { markdownToHtml, plainText } from '../markdown'
import { reportSilent } from '../error-report'
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

function advertisedFxTools() {
  const kernel = loadKernel()
  const canonical = isBashKernel(kernel) ? canonicalAcpTools(kernel.BASH_TOOL_CONTRACT_SOURCE) : []
  return [...DEMO_TOOLS, ...canonical]
}

function executeDemoTool(name: string, input: unknown): HostToolResult {
  const args = (input ?? {}) as Record<string, unknown>
  if (name === 'get_weather') {
    return { content: JSON.stringify({ city: args.city, temp_c: 22, condition: 'sunny', source: 'dsh-mini-demo' }), isError: false }
  }
  return { content: `unknown tool ${name}`, isError: true }
}

/** fx 与 nano 共用 canonical 工具名；fs 仍只进 services/vfs。 */
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
    // 已删会话的楔死轮同样占链头——同武装取消看守（审查十二轮 D4）。
    this.armCancelWatchdog(id)
    if (this.activeDshId === id) this.activeDshId = undefined
    if (this.acpActive !== undefined && this.acpActive.dshId === id) this.acpActive = undefined
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
    const messageId = randomId('user')
    const prevTitle = s.summary.title
    const prevLastMessage = s.summary.lastMessage
    try {
      this.append(id, { kind: 'user_message', id: messageId, seq: this.nextSeq(s), text, images: images.length > 0 ? images : undefined })
      if (s.summary.title === '新会话' && text.trim().length > 0) s.summary.title = text.trim().slice(0, 28)
      this.persist()
    } catch (e) {
      // persist/quota 抛错不得滞留 running——否则该会话此后永不可 prompt（F5-1 同族）。
      // append 先 push 后 persist：抛错时消息行已在 items 而 append 事件未发——
      // 回滚该行保持转录/UI 一致（审查十二轮 D8）；title/lastMessage 同回滚，
      // 否则未发出的草稿永久占住标题派生（F-3 残余面）。
      s.summary.status = 'idle'
      const idx = s.items.findIndex((i) => i.id === messageId)
      if (idx !== -1) s.items.splice(idx, 1)
      s.summary.messageCount = s.items.length
      s.summary.title = prevTitle
      s.summary.lastMessage = prevLastMessage
      throw e
    }
    this.emit({ type: 'status', sessionId: id, state: 'running', step: 1 })

    const epoch = (this.turnEpoch.get(id) ?? 0) + 1
    this.turnEpoch.set(id, epoch)
    void this.runTurn(id, blocks, epoch).catch((error) => {
      // 已删会话的迟到失败不发全局横幅（删除竞态，UI 审查 F5——与 kernel fail 同构）。
      if (this.sessions.get(id) === undefined) {
        console.warn(`[fx-runtime] turn_failed on deleted session ${id}:`, error instanceof Error ? error.message : error)
        reportSilent(error, { op: 'turn-late-fail', lane: 'fx', sessionId: id })
        return
      }
      // 换代后的迟到失败（cancel+重发/看守强收）——新轮已接管 status，
      // 旧轮不得覆写 error 或弹幽灵横幅（审查十二轮 D1b）。
      if (this.turnEpoch.get(id) !== epoch) {
        // 但旧轮 delta 可能已重建 streaming 泡且无人收——补 settle 收幽灵泡；
        // 此刻链上仅本 turn 刚退出、新轮尚未产 delta，settle 不误杀（审查十二轮 F-1）。
        this.emit({ type: 'assistant.settle', sessionId: id, seq: 0, messageId: '' })
        console.warn(`[fx-runtime] stale turn_failed suppressed for ${id}:`, error instanceof Error ? error.message : error)
        reportSilent(error, { op: 'turn-stale-fail', lane: 'fx', sessionId: id })
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
    // 取消无应答看守——令牌代校验：空会话 cancel 不武装，已结算轮的令牌不
    // 会误判新轮（审查十二轮 D2/D5）。
    this.armCancelWatchdog(id)
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
    const verdict = outcome === 'allowed-once' ? 'allow' : 'deny'
    if (settleHostApproval(approvalId, verdict)) return
    const p = this.pendingPermissions.get(approvalId)
    if (p === undefined) return
    this.pendingPermissions.delete(approvalId)
    p.resolve(verdict === 'allow' ? p.allowOptionId : null)
  }

  answerQuestion(_questionId: string, _answers: QuestionAnswer[]): void {
    // fx core 的 question 面未接（libfx hooks 未启用）。
  }

  clear(): void {
    this.sessions.clear()
    this.turnEpoch.clear()
    this.restartCore()
    storage.clearConversations()
  }

  /** 重启 wasm core（模型切换/注入变更后调用）：会话数据保留，acp 会话句柄作废。 */
  restartCore(): void {
    // 世代号递增——ensureCore 在途 IIFE 检出过期后不落地 stale-model 核（审查八轮 D4）。
    this.coreGen += 1
    this.acpSessions.clear()
    this.acpActive = undefined
    // 未决 permission 以 null 收（与 cancel 同构）——否则 wasm 侧 request_permission
    // 等答复永挂、turn 卡 running；dispose 拒绝 acp pending 使 client.prompt 的
    // await 被拒而非死等（wasm.abort 后响应永不至）。approval.cancel 同步收 UI 卡（审查九轮 D9a）。
    this.resolveSessionApprovals()
    // 非 client-await（ready/start/instantiate）的竞争者实拒——否则其楔死
    // 不在 dispose 视野，turnChain 链头仍占（审查十二轮 F-5）。
    for (const r of this.restartSignals) r(new Error('fx core 已重启'))
    this.restartSignals.clear()
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
      const source = await this.raceWithRestart(ticket.ready())
      // ready() 可达 challenge/SOTER 秒级——期间 restartCore 换代后 resume 写共享
      // 字段会覆盖新一代 starting* 注册使其资源不可达（审查十轮 D10-1）；抛错而
      // 非空 resolve——等待方须得到实拒而非走 client! TypeError（审查十轮 D10-4）。
      if (this.coreGen !== gen) throw new Error('fx core 已重启')
      const fxEnv = { ...cfg.fxEnv }
      // wasm provider 定义以生效源重建：cloudish 时 base_url 改写为数据面代理（wasm 无感，见 rules/topology-local.md §4）
      // proxyBaseUrl 带 /vN 尾时不再补 /v1——io.llm chatUrl 同款归一（MN03-R5 minor）。
      const baseUrl = route.proxyBaseUrl !== undefined
        ? (() => { const b = route.proxyBaseUrl.replace(/\/+$/, ''); return /\/v\d+$/i.test(b) ? b : `${b}/v1` })()
        : source.upstreamBaseUrl
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
        tools: advertisedFxTools(),
        executeTool: async (name, input, _callId, sid) => this.dispatchTool(name, input, sid),
        onUpdate: (acpId, update) => this.onUpdate(acpId, update),
        onPermission: (params) => this.onPermission(params),
        onProtocolError: (e) => {
          this.emit({ type: 'error', code: 'protocol', message: `fx 协议异常: ${e.message}`, retryable: false })
        },
      })
      this.startingClient = client
      await this.raceWithRestart(wasm.start(devConfig!.wasmPath))
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

  /** wasm 侧 libfx 会话为单活动槽：`libfx/new` 销毁旧活动会话（非挂起），
   *  `session/prompt` 打非活动 id 即 "Session is not active"。acpSessions 多会话
   *  映射若盲信 known 会把已被销毁的槽当活——交替会话后旧会话永砖（审查十二轮
   *  D3）。acpActive 记当前真活动槽；换会话=旧槽已死，诚实重建。 */
  private acpActive: { dshId: string; acpId: string } | undefined

  private async ensureAcpSession(dshId: string): Promise<string> {
    if (this.acpActive !== undefined && this.acpActive.dshId === dshId) return this.acpActive.acpId
    // 宿主侧铸造 acpId——wasm 若按序铸号，restartCore 后新核可能重发同号，
    // 使 cancel 看守的 turns.has(acpId) 误判健康新轮为悬死旧轮（审查十一轮自审）。
    const acpId = await this.client!.newSession(randomId('acp'))
    // 本次 new 已销毁旧活动会话——其映射是死引用，诚实清除。
    if (this.acpActive !== undefined && this.acpSessions.get(this.acpActive.dshId) === this.acpActive.acpId) {
      this.acpSessions.delete(this.acpActive.dshId)
    }
    this.acpSessions.set(dshId, acpId)
    this.acpActive = { dshId, acpId }
    return acpId
  }

  // ---- turn ----

  /** tool_call 分派：canonical 名走与 nano 相同的 executor；get_weather 仍是 demo。 */
  private async dispatchTool(name: string, input: unknown, acpId: string | undefined): Promise<HostToolResult> {
    if (name === 'get_weather') return executeDemoTool(name, input)
    const kernel = loadKernel()
    const dshId = acpId !== undefined ? this.findDshId(acpId) : this.activeDshId
    if (!isBashKernel(kernel) || dshId === undefined) {
      return { content: JSON.stringify({ error: 'tool-call-failed', message: 'kernel tool surface unavailable' }), isError: true }
    }
    const result = await runCanonicalTool(kernel, dshId, name, input)
    const text = result.text ?? result.message ?? ''
    return { content: text, isError: result.kind === 'error' || result.kind === 'rejected' }
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

  /** 在飞轮次令牌（dshId→token）——cancel/remove 的 20s 无结算看守以令牌校验轮代。
   *  turns map 只有 acpId 槽位：ensureCore/ready/newSession 阶段楔死无登记（盲），
   *  且同槽复用无法区分轮代（误杀健康新轮）；令牌自 runTurnInner 入口即存、
   *  双终局清（审查十二轮 D2/D5）。 */
  private readonly inFlightTurns = new Map<string, unknown>()

  /** restartCore 强收信号——client.pending 可经 dispose 拒绝，但 ticket.ready()/
   *  wasm.start 等非 client-await 不被 restartCore 触及：楔死即 turnChain 永占
   *  链头（审查十二轮 F-5）。restartCore 拒绝全部注册竞争。 */
  private readonly restartSignals = new Set<(e: Error) => void>()

  private raceWithRestart<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onDead = (e: Error) => reject(e)
      this.restartSignals.add(onDead)
      p.then(
        (v) => { this.restartSignals.delete(onDead); resolve(v) },
        (e) => { this.restartSignals.delete(onDead); reject(e) },
      )
    })
  }

  /** 取消无应答看守：session/cancel fire-and-forget——任何阶段楔死 20s 未结算
   *  即 restartCore 全量强收（拒 pending+abort wedged wasm+换代+清 acpSessions），
   *  turnChain 链头解除、次轮重建新核（审查十一轮 D11-3/十二轮 D4）。 */
  private armCancelWatchdog(id: string): void {
    const victim = this.inFlightTurns.get(id)
    if (victim === undefined) return
    setTimeout(() => {
      if (this.inFlightTurns.get(id) === victim) {
        console.warn(`[fx-runtime] 会话 ${id} 轮次取消未结算——restartCore 强收`)
        reportSilent(new Error('轮次取消 20s 未结算——restartCore 强收'), { op: 'cancel-watchdog', lane: 'fx', sessionId: id })
        this.restartCore()
      }
    }, 20_000)
  }

  private runTurn(dshId: string, blocks: AcpPromptBlock[], epoch: number): Promise<void> {
    const run = this.turnChain.then(() => {
      const s = this.sessions.get(dshId)
      // epoch 为唯一权威闸门：cancel/remove/重发都换代或删会话；status 检查既冗余
      // 又会把旧轮的迟到状态覆写转化为新轮静默吞没（审查十二轮 D1）。
      if (s === undefined || this.turnEpoch.get(dshId) !== epoch) return
      return this.runTurnInner(dshId, blocks, epoch)
    })
    this.turnChain = run.catch(() => { /* 单轮失败不断链 */ })
    return run
  }

  private async runTurnInner(dshId: string, blocks: AcpPromptBlock[], epoch: number): Promise<void> {
    const s = this.require(dshId)
    // 令牌自入口即存——ensureCore/ready/newSession 任一阶段楔死皆在看守视野内。
    const token: unknown = {}
    this.inFlightTurns.set(dshId, token)
    try {
      await this.ensureCore()
      if (this.turnEpoch.get(dshId) !== epoch) return
      // 票据过期重铸：core 常驻跨多轮，ensureCore 只在首轮铸票——票据 ~30min TTL
      // 过期后 env.fetch 的 authHeaders 永久空头上行=每轮 401 死锁（审查三轮 N2）。
      // runTurn=用户手势上下文，ready() 允许 SOTER；local 车道 ready() 为纯解析零成本。
      if (this.ticket !== undefined && !hasFreshTicket()) await this.raceWithRestart(this.ticket.ready())
      // ready() 重铸可达 challenge/SOTER 秒级——窗内 restartCore 清 client 后
      // 直进 ensureAcpSession 会撞 client!.newSession TypeError（审查十一轮 D11-2）。
      if (this.client === undefined) throw new Error('fx core 已重启')
      let acpId = await this.ensureAcpSession(dshId)
      // 出队后至 prompt 注册间的全部 await（ensureCore/ready/ensureAcpSession）窗口内
      // cancel+重发换代——旧轮不得借新轮 running 复活（审查十一轮自审+D12）。
      if (this.turnEpoch.get(dshId) !== epoch) return
      const turn: TurnState = { attemptId: randomId('attempt'), text: '', thinking: '', deltaIndex: 0, toolItemByCallId: new Map() }
      this.turns.set(acpId, turn)
      // wasm host-import 通道（fx_host_tool_call）不带 sessionId——单活动会话下以在飞轮次兜底。
      this.activeDshId = dshId
      try {
        try {
          await this.client!.prompt(acpId, blocks)
        } catch (e) {
          // wasm 单活动槽在 libfx/new 之外被毁（核心自溃/释放后故障）→ 死柄永砖：
          // 检出即作废槽位+映射，重铸一次（审查十二轮 F-6）。
          if (!(e instanceof Error && e.message.includes('Session is not active'))) throw e
          this.turns.delete(acpId)
          this.acpSessions.delete(dshId)
          if (this.acpActive !== undefined && this.acpActive.dshId === dshId) this.acpActive = undefined
          acpId = await this.ensureAcpSession(dshId)
          if (this.turnEpoch.get(dshId) !== epoch) return
          this.turns.set(acpId, turn)
          await this.client!.prompt(acpId, blocks)
        }
      } finally {
        this.turns.delete(acpId)
        this.activeDshId = undefined
        // 轮失败/中止在 request_permission 悬于未答时——轮终即该请求永不可答，
        // 连 UI 卡以 null+cancel 收（审查十一轮 D11-4）。
        this.resolveSessionApprovals(dshId)
        // 轮终仍 running 的工具卡不再有更新路径——cancel/看守杀/遗漏皆成永转
        // 幽灵卡（审查十二轮 F-2，与 kernel D1 终态化同构）。
        for (const itemId of turn.toolItemByCallId.values()) {
          const current = s.items.find((i) => i.id === itemId)
          if (current?.kind === 'tool_call' && current.status === 'running') {
            try {
              this.replace(dshId, { ...current, status: 'error', detail: current.detail ?? '（轮次结束时工具调用未返回）' })
            } catch (e) {
              console.warn('[fx-runtime] 工具卡终态化失败:', e instanceof Error ? e.message : e)
            }
          }
        }
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
      // 迟到尾写 epoch 守卫：cancel 后 wasm 以 stopReason:'cancelled' resolve 本 turn——
      // 若用户已重发（新轮 running），无条件落 idle 会踩掉新轮状态、使其在 dequeue
      // 被误吞（审查十二轮 D1a）。转录行保留=部分输出如实，仅状态面换代接管。
      if (this.turnEpoch.get(dshId) === epoch) {
        s.summary.status = 'idle'
        s.summary.updatedAt = Date.now()
        this.emit({ type: 'status', sessionId: dshId, state: 'idle' })
        this.persist()
      }
      this.emit({ type: 'assistant.settle', sessionId: dshId, seq: item.seq, messageId: item.id })
    } finally {
      if (this.inFlightTurns.get(dshId) === token) this.inFlightTurns.delete(dshId)
    }
  }

  private onUpdate(acpId: string, update: AcpUpdate): void {
    const dshId = this.findDshId(acpId)
    if (dshId === undefined) return
    const turn = this.turns.get(acpId)
    let canonical
    try {
      canonical = fxToCanonical(update)
    } catch (error) {
      this.emit({ type: 'error', code: 'fx.update', message: error instanceof Error ? error.message : String(error), retryable: false })
      return
    }
    const derived = derive({ ...canonical, session_uuid: dshId })
    if (derived.surface === 'local-event' && derived.event.type === 'assistant.delta') {
      const text = derived.event.text
      if (text.length === 0) return
      const index = turn ? turn.deltaIndex++ : 0
      if (turn) turn.text += text
      this.emit({ type: 'assistant.delta', sessionId: dshId, attemptId: turn?.attemptId ?? 'unknown', index, text })
      return
    }
    if (derived.surface === 'chat-item' && derived.item.kind === 'notice' && turn && update.sessionUpdate === 'agent_thought_chunk') {
      turn.thinking += derived.item.text
      return
    }
    if (derived.surface === 'chat-item') {
      const s = this.require(dshId)
      const item = { ...derived.item, id: derived.item.id || randomId('fx'), seq: this.nextSeq(s) }
      if (item.kind === 'tool_call' && typeof update.toolCallId === 'string') {
        turn?.toolItemByCallId.set(update.toolCallId, item.id)
      }
      this.append(dshId, item)
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
