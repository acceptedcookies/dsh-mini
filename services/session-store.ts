import { localRuntime } from './local-runtime'
import { FxLocalRuntime, fxRuntime } from './fx/runtime'
import { kernelRuntime, KernelMiniRuntime } from './nano-mini-host/runtime'
import { loadKernelAsync } from './nano-mini-host/kernel-loader'
import { nanoRuntime } from './nano/runtime'
import { upsertItem } from './event-fold'
import { storage } from './storage'
import { throttle } from '../utils/throttle'
import type {
  ApprovalOutcome,
  ChatItem,
  ImageRef,
  LocalEvent,
  QuestionAnswer,
  SessionSnapshot,
  SessionSummary,
  UiState,
} from '../types/protocol'

const initialState: UiState = {
  sessions: [],
  approvals: [],
  questions: [],
  loadingSessions: true,
  loadingSession: false,
  sending: false,
}

type Listener = (state: UiState) => void

interface AgentRuntime {
  subscribe(listener: (event: LocalEvent) => void): () => void
  list(): SessionSummary[] | Promise<SessionSummary[]>
  open(id: string): SessionSnapshot | Promise<SessionSnapshot>
  create(): SessionSummary | Promise<SessionSummary>
  rename(id: string, title: string): SessionSummary | Promise<SessionSummary>
  remove(id: string): void | Promise<void>
  prompt(id: string, text: string, images?: ImageRef[]): { messageId: string } | Promise<{ messageId: string }>
  cancel(id: string): void | Promise<void>
  answerApproval(approvalId: string, outcome: ApprovalOutcome): void | Promise<void>
  answerQuestion(questionId: string, answers: QuestionAnswer[]): void | Promise<void>
  clear(): void | Promise<void>
}

class SessionStore {
  private state: UiState = initialState
  private readonly listeners = new Set<Listener>()
  private initialized = false
  private runtime: AgentRuntime = localRuntime
  private usingNano = false
  private unsubscribeRuntime: (() => void) | undefined

  private readonly publishStreaming = throttle(() => this.publish(), 60)

  getState(): UiState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    // 在途 open 属于前一绑定——序号换代防其落入新 runtime 状态（审查八轮 D7）。
    this.openSeq += 1
    try {
      await this.bindRuntime()
    } catch (error) {
      this.setState({ loadingSessions: false, loadingSession: false, error: messageOf(error) })
      return
    }
    const sessions = this.state.sessions
    const last = storage.getLastSessionId()
    const target = last !== undefined && sessions.some((session) => session.id === last) ? last : undefined
    if (target !== undefined) await this.open(target)
    else this.setState({ current: undefined, loadingSessions: false, loadingSession: false })
  }

  async reinitialize(): Promise<void> {
    // 在途 open 属于前一绑定——序号换代防其落入新 runtime 状态（审查八轮 D7）。
    this.openSeq += 1
    this.unsubscribeRuntime?.()
    this.unsubscribeRuntime = undefined
    this.setState({
      ...initialState,
      loadingSessions: true,
    })
    try {
      await this.bindRuntime()
    } catch (error) {
      this.setState({ loadingSessions: false, loadingSession: false, error: messageOf(error) })
      return
    }
    const first = this.state.sessions[0]
    if (first !== undefined) await this.open(first.id)
    else this.setState({ current: undefined, loadingSessions: false, loadingSession: false })
  }

  private async bindRuntime(): Promise<void> {
    this.usingNano = nanoRuntime.isAvailable()
    // 真机：kernel 纯资源分包经 preloadRule 异步下载——等可用再选车道（12s 上限防阻塞）
    await loadKernelAsync(12000)
    // 引擎选择缝（AP §4 P2-06）：nano 登录 > kernelRuntime（T2 状态机，T-O-1 默认）
    // > fxLegacy knob 显式回退 fx > localRuntime demo 兜底。
    this.runtime = this.usingNano
      ? nanoRuntime
      : KernelMiniRuntime.isUsable()
        ? kernelRuntime
        : FxLocalRuntime.isUsable()
          ? fxRuntime
          : localRuntime
    this.unsubscribeRuntime = this.runtime.subscribe((event) => this.apply(event))
    const sessions = await this.runtime.list()
    this.setState({ sessions, loadingSessions: false })
  }

  runtimeLabel(): string {
    if (this.usingNano) return `nano-agent · ${nanoRuntime.userLabel()}`
    if (this.runtime === kernelRuntime) return '本地运行时 · nano-kernel'
    return this.runtime === fxRuntime ? '本地运行时 · fx' : '本地运行时'
  }

  async loadSessions(): Promise<void> {
    this.setState({ sessions: await this.runtime.list(), loadingSessions: false })
  }

  private openSeq = 0

  async open(sessionId: string): Promise<void> {
    const req = ++this.openSeq
    this.setState({ loadingSession: true, error: undefined, approvals: [], questions: [], streaming: undefined })
    try {
      const snapshot = await this.runtime.open(sessionId)
      // 连点 A→B 时慢快照后至——陈旧快照与 lastSessionId 均不落（UI 审查 F4）。
      if (req !== this.openSeq) return
      // await 窗内会话被删——快照不落为 current（nano 车道 loadHistory 异步可达，审查八轮 D8）。
      if (!this.state.sessions.some((session) => session.id === sessionId)) {
        this.setState({ loadingSession: false })
        return
      }
      storage.setLastSessionId(sessionId)
      this.setState({ current: snapshot, loadingSession: false })
    } catch (error) {
      if (req !== this.openSeq) return
      this.setState({ loadingSession: false, error: messageOf(error) })
    }
  }

  async create(): Promise<string | undefined> {
    try {
      const summary = await this.runtime.create()
      this.setState({ sessions: await this.runtime.list() })
      await this.open(summary.id)
      return summary.id
    } catch (error) {
      this.setState({ error: messageOf(error) })
      return undefined
    }
  }

  async prompt(text: string, images: ImageRef[] = []): Promise<boolean> {
    // sending 单飞——setState→组件回写有传播窗，连点会并发 prompt；冷启动双击
    // 还会穿 create() 产双会话（审查八轮 D3）。检查+置位须先于任何 await。
    if (this.state.sending || (text.trim().length === 0 && images.length === 0)) return false
    this.setState({ sending: true, error: undefined })
    try {
      if (this.state.current === undefined) {
        const id = await this.create()
        if (id === undefined) return false
      }
      const current = this.state.current
      if (current === undefined) return false
      await this.runtime.prompt(current.sessionId, text, images)
      return true
    } catch (error) {
      this.setState({ error: messageOf(error) })
      return false
    } finally {
      this.setState({ sending: false })
    }
  }

  async cancel(): Promise<void> {
    const current = this.state.current
    if (current === undefined) return
    try {
      await this.runtime.cancel(current.sessionId)
    } catch (error) {
      this.setState({ error: messageOf(error) })
    }
  }

  async rename(title: string): Promise<void> {
    const current = this.state.current
    if (current === undefined || title.trim().length === 0) return
    try {
      await this.runtime.rename(current.sessionId, title.trim())
      await this.syncSessions()
    } catch (error) {
      this.setState({ error: messageOf(error) })
    }
  }

  /** 按 id 重命名（不强开目标会话——侧栏操作不得偷换上下文，UI 审查 F13）。 */
  async renameById(sessionId: string, title: string): Promise<void> {
    if (title.trim().length === 0) return
    try {
      await this.runtime.rename(sessionId, title.trim())
      await this.syncSessions()
    } catch (error) {
      this.setState({ error: messageOf(error) })
    }
  }

  async remove(sessionId: string): Promise<void> {
    try {
      await this.runtime.remove(sessionId)
    } catch (error) {
      this.setState({ error: messageOf(error) })
    }
    await this.syncSessions()
    if (this.state.current?.sessionId !== sessionId) return
    const next = this.state.sessions[0]
    if (next !== undefined) void this.open(next.id)
    else this.setState({ current: undefined })
  }

  async answerApproval(approvalId: string, outcome: ApprovalOutcome): Promise<void> {
    this.setState({ approvals: this.state.approvals.filter((item) => item.id !== approvalId) })
    try {
      await this.runtime.answerApproval(approvalId, outcome)
    } catch (error) {
      this.setState({ error: messageOf(error) })
    }
  }

  async answerQuestion(questionId: string, answers: QuestionAnswer[]): Promise<void> {
    this.setState({ questions: this.state.questions.filter((item) => item.id !== questionId) })
    try {
      await this.runtime.answerQuestion(questionId, answers)
    } catch (error) {
      this.setState({ error: messageOf(error) })
    }
  }

  dismissQuestion(questionId: string): void {
    this.setState({ questions: this.state.questions.filter((item) => item.id !== questionId) })
  }

  dismissError(): void {
    this.setState({ error: undefined })
  }

  async clearAll(): Promise<void> {
    await this.runtime.clear()
    this.setState({
      ...initialState,
      loadingSessions: false,
    })
  }

  private apply(event: LocalEvent): void {
    switch (event.type) {
      case 'session.snapshot': {
        if (this.state.current?.sessionId === event.sessionId) {
          this.setState({
            current: {
              sessionId: event.sessionId,
              cursor: event.cursor,
              status: event.status,
              items: event.items,
              hasMore: event.hasMore,
            },
          })
        }
        break
      }
      case 'item.append': {
        this.appendToCurrent(event.sessionId, event.item, event.seq)
        this.touchSession(event.sessionId, event.item)
        break
      }
      case 'item.replace': {
        this.appendToCurrent(event.sessionId, event.item, event.seq)
        this.touchSession(event.sessionId, event.item)
        break
      }
      case 'assistant.delta': {
        if (this.state.current?.sessionId !== event.sessionId) break
        const existing = this.state.streaming
        const text = existing?.attemptId === event.attemptId ? existing.text + event.text : event.text
        this.state = {
          ...this.state,
          streaming: { attemptId: event.attemptId, sessionId: event.sessionId, text },
        }
        this.publishStreaming()
        break
      }
      case 'assistant.settle': {
        if (this.state.streaming?.sessionId === event.sessionId) {
          this.setState({ streaming: undefined })
        }
        break
      }
      case 'status': {
        const current = this.state.current?.sessionId === event.sessionId
          ? { ...this.state.current, status: event.state }
          : this.state.current
        this.setState({
          current,
          // delta 后失败/挂起不 settle——error/idle 必须同步清 streaming 幽灵泡（审查 B8）。
          streaming: event.state === 'error' || event.state === 'idle'
            ? (this.state.streaming?.sessionId === event.sessionId ? undefined : this.state.streaming)
            : this.state.streaming,
          sessions: this.state.sessions.map((session) => session.id === event.sessionId
            ? { ...session, status: event.state, updatedAt: Date.now() }
            : session),
        })
        break
      }
      case 'approval.request': {
        this.setState({ approvals: [...this.state.approvals, event.approval] })
        break
      }
      case 'approval.cancel': {
        this.setState({ approvals: this.state.approvals.filter((item) => item.id !== event.approvalId) })
        break
      }
      case 'question.ask': {
        this.setState({ questions: [...this.state.questions, event.question] })
        break
      }
      case 'error': {
        // 用户主动 stop 在 fx/local 车道落成 error 事件——不是故障，过滤掉
        // 红色横幅（kernel 车道本就不发；UI 审查 F14）。
        if (event.code === 'cancelled') break
        this.setState({ error: event.message })
        break
      }
    }
  }

  private appendToCurrent(sessionId: string, item: ChatItem, seq: number): void {
    const current = this.state.current
    if (current?.sessionId !== sessionId) return
    const previous = current.items.find((candidate) => candidate.id === item.id)
    const stamped: ChatItem = item.ts === undefined
      ? ({ ...item, ts: previous?.ts ?? Date.now() } as ChatItem)
      : item
    this.setState({
      current: {
        ...current,
        items: upsertItem(current.items, stamped),
        cursor: Math.max(current.cursor, seq),
      },
    })
  }

  private touchSession(sessionId: string, item: ChatItem): void {
    const text = item.kind === 'user_message' || item.kind === 'assistant_message'
      ? item.text
      : item.kind === 'tool_call'
        ? item.title
        : item.kind === 'tool_result'
          ? item.summary
          : item.kind === 'notice'
            ? item.text
            : item.path
    this.setState({
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? {
            ...session,
            // 派生标题的存储侧投影：runtime 改 summary.title 但不发 summary 事件——
            // 首条 user_message 落地时同步推导（与 runtime 同规则，UI 审查 F3）。
            title: session.title === '新会话' && item.kind === 'user_message' && item.text.trim().length > 0
              ? item.text.trim().slice(0, 28)
              : session.title,
            lastMessage: text.slice(0, 80),
            messageCount: session.id === this.state.current?.sessionId
              ? this.state.current.items.length
              : session.messageCount,
            updatedAt: Date.now(),
          }
        : session),
    })
  }

  private async syncSessions(): Promise<void> {
    this.setState({ sessions: await this.runtime.list() })
  }

  private setState(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch }
    this.publish()
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误'
}

export const sessionStore = new SessionStore()
