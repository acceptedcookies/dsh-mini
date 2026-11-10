import { markdownToHtml } from '../markdown'
import type {
  ApprovalOutcome,
  ApprovalRequest,
  ChatItem,
  ImageRef,
  LocalEvent,
  SessionSnapshot,
  SessionSummary,
} from '../../types/protocol'
import { randomId } from '../../utils/uuid'
import { projectReceipt, toCanonical } from '../nacp/adapters/remote'
import { derive } from '../nacp/derive'
import {
  cancelTurn,
  clearAuth,
  createSession,
  decideConfirmation,
  deleteConversation,
  fetchHistory,
  getStoredUser,
  hasNanoSession,
  listSessions,
  renameConversation,
  sendInput,
  startSession,
} from './http'
import { connectNanoStream, type NanoStream } from './stream'
import type { NanoFrame, NanoHistory, NanoHistoryItem, NanoSessionSummary } from './types'

interface NanoToolState {
  id: string
  seq: number
  name: string
  detail: string
  status: 'running' | 'ok' | 'error'
}

interface NanoSessionState {
  summary: SessionSummary
  conversationId?: string
  remoteStatus: string
  cursor: number
  resumeCursor?: string
  started: boolean
  loaded: boolean
  items: ChatItem[]
  seq: number
  assistantId?: string
  assistantSeq: number
  assistantText: string
  assistantThinking: string
  tools: Map<string, NanoToolState>
  flushTimer?: ReturnType<typeof setTimeout>
}

function nowSummary(summary: NanoSessionSummary, previous?: SessionSummary): SessionSummary {
  const updatedAt = Date.parse(summary.last_seen_at ?? summary.started_at ?? summary.created_at ?? '')
  const lastPhase = summary.last_phase ?? ''
  const running = summary.status === 'starting' || lastPhase === 'turn_running' || lastPhase === 'compact_running'
  return {
    id: summary.session_uuid,
    title: summary.title?.trim() || previous?.title || '新会话',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : previous?.updatedAt ?? Date.now(),
    status: running ? 'running' : 'idle',
    lastMessage: previous?.lastMessage ?? 'nano-agent 会话',
    messageCount: previous?.messageCount ?? 0,
  }
}

function textOf(body: Record<string, unknown> | undefined): string {
  if (body === undefined) return ''
  if (typeof body.text === 'string') return body.text
  if (typeof body.content === 'string') return body.content
  if (Array.isArray(body.parts)) {
    return body.parts
      .map((part) => {
        if (part === null || typeof part !== 'object') return ''
        const row = part as Record<string, unknown>
        return row.kind === 'text' && typeof row.text === 'string' ? row.text : ''
      })
      .filter((part) => part.length > 0)
      .join('\n')
  }
  return ''
}

function thinkingOf(body: Record<string, unknown> | undefined): string | undefined {
  if (body === undefined) return undefined
  if (typeof body.thinking === 'string' && body.thinking.length > 0) return body.thinking
  if (typeof body.reasoning === 'string' && body.reasoning.length > 0) return body.reasoning
  return undefined
}

function itemSeq(item: NanoHistoryItem, fallback: number): number {
  const value = item.global_seq ?? item.event_seq ?? item.emit_seq
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function itemTs(item: NanoHistoryItem): number | undefined {
  if (typeof item.created_at !== 'string' || item.created_at.length === 0) return undefined
  const value = Date.parse(item.created_at)
  return Number.isFinite(value) ? value : undefined
}

function historyItems(history: NanoHistory): ChatItem[] {
  const source = history.items ?? history.messages ?? []
  const result: ChatItem[] = []
  let fallback = 0
  for (const item of source) {
    fallback += 1
    const seq = itemSeq(item, fallback)
    const ts = itemTs(item)
    const stamp = ts === undefined ? {} : { ts }
    const kind = (item.kind ?? '').toLowerCase()
    const body = item.body ?? {}
    const text = textOf(body)
    if (kind.includes('assistant')) {
      if (text.trim().length === 0) continue
      result.push({
        kind: 'assistant_message',
        id: item.message_uuid || randomId('msg'),
        seq,
        text,
        html: markdownToHtml(text),
        thinking: thinkingOf(body),
        ...stamp,
      })
      continue
    }
    if (kind.includes('user')) {
      if (text.trim().length === 0) continue
      result.push({
        kind: 'user_message',
        id: item.message_uuid || randomId('user'),
        seq,
        text,
        ...stamp,
      })
      continue
    }
    if (kind.includes('tool')) {
      const tool = typeof body.tool_name === 'string' ? body.tool_name : 'tool'
      const status = typeof body.status === 'string' ? body.status : ''
      const output = typeof body.output === 'string'
        ? body.output
        : typeof body.result === 'string'
          ? body.result
          : ''
      const error = typeof body.error_message === 'string' ? body.error_message : ''
      if (kind.includes('result') || status === 'completed' || status === 'succeeded' || status === 'failed') {
        result.push({
          kind: 'tool_result',
          id: item.message_uuid || randomId('result'),
          seq,
          tool,
          status: status === 'failed' || error.length > 0 ? 'error' : 'ok',
          summary: error.length > 0 ? error : output.slice(0, 160) || '工具已完成',
          detail: error.length > 0 ? error : output,
          ...stamp,
        })
      } else {
        result.push({
          kind: 'tool_call',
          id: item.message_uuid || randomId('tool'),
          seq,
          tool,
          status: 'ok',
          title: tool,
          detail: typeof body.arguments === 'string' ? body.arguments : undefined,
          args: typeof body.arguments === 'string' ? body.arguments : undefined,
          ...stamp,
        })
      }
      continue
    }
    if (kind.includes('system') || kind.includes('notice')) {
      result.push({
        kind: 'notice',
        id: item.message_uuid || randomId('notice'),
        seq,
        level: 'info',
        text: text || '系统通知',
        ...stamp,
      })
    }
  }
  return result
}

export class NanoRuntime {
  private readonly sessions = new Map<string, NanoSessionState>()
  private readonly listeners = new Set<(event: LocalEvent) => void>()
  private readonly streams = new Map<string, NanoStream>()

  isAvailable(): boolean {
    return hasNanoSession()
  }

  userLabel(): string {
    return getStoredUser()?.display_name ?? 'nano-agent'
  }

  subscribe(listener: (event: LocalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(): Promise<SessionSummary[]> {
    if (!this.isAvailable()) return []
    const remote = await listSessions()
    const remoteIds = new Set<string>()
    for (const summary of remote.sessions) {
      remoteIds.add(summary.session_uuid)
      const previous = this.sessions.get(summary.session_uuid)
      const mapped = nowSummary(summary, previous?.summary)
      const state = previous ?? this.ensureState(mapped)
      state.summary = mapped
      state.conversationId = summary.conversation_uuid ?? state.conversationId
      state.remoteStatus = summary.status
      state.loaded = false
      state.started = summary.status !== 'pending'
    }
    for (const [id, state] of this.sessions) {
      if (!remoteIds.has(id) && state.started) this.sessions.delete(id)
    }
    return [...this.sessions.values()]
      .map((state) => ({ ...state.summary }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async open(id: string): Promise<SessionSnapshot> {
    const state = this.ensure(id)
    if (!state.loaded && state.started) await this.loadHistory(id)
    if (state.started && state.remoteStatus !== 'ended' && state.remoteStatus !== 'expired') this.attach(id)
    return this.snapshot(state)
  }

  async create(): Promise<SessionSummary> {
    const created = await createSession()
    const summary: SessionSummary = {
      id: created.session_uuid,
      title: '新会话',
      updatedAt: Date.now(),
      status: 'idle',
      // 云端引擎戳记（MN03）：nano 车道建的会话恒为 cloud-runtime。
      engine: 'cloud',
      lastMessage: '等待第一条消息',
      messageCount: 0,
    }
    const state = this.ensureState(summary)
    state.conversationId = created.conversation_uuid ?? undefined
    state.started = false
    state.remoteStatus = created.status
    this.emit({ type: 'status', sessionId: summary.id, state: 'idle' })
    return { ...summary }
  }

  async rename(id: string, title: string): Promise<SessionSummary> {
    const state = this.ensure(id)
    state.summary = { ...state.summary, title, updatedAt: Date.now() }
    if (state.conversationId !== undefined) {
      await renameConversation(state.conversationId, title)
    }
    return { ...state.summary }
  }

  async remove(id: string): Promise<void> {
    const state = this.sessions.get(id)
    this.detach(id)
    this.sessions.delete(id)
    if (state?.conversationId !== undefined) await deleteConversation(state.conversationId)
  }

  async prompt(id: string, text: string, images: ImageRef[] = []): Promise<{ messageId: string }> {
    if (images.length > 0) throw new Error('nano-agent 附件上传尚未接入')
    const state = this.ensure(id)
    const messageId = randomId('user')
    this.append(state, {
      kind: 'user_message',
      id: messageId,
      seq: this.nextSeq(state),
      text,
    })
    state.summary.title = state.summary.title === '新会话' ? text.trim().slice(0, 28) || '新会话' : state.summary.title
    state.summary.lastMessage = text.slice(0, 80)
    state.summary.messageCount = state.items.length
    state.summary.status = 'running'
    state.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId: id, state: 'running' })

    try {
      if (!state.started) {
        const started = await startSession(id, text)
        state.started = true
        state.remoteStatus = typeof started.session_status === 'string'
          ? started.session_status
          : typeof started.status === 'string'
            ? started.status
            : 'active'
        if (typeof started.first_event_seq === 'number') state.cursor = started.first_event_seq
        if (typeof started.resume_cursor === 'string') state.resumeCursor = started.resume_cursor
        this.attach(id)
      } else {
        await sendInput(id, text)
        this.attach(id)
      }
    } catch (error) {
      state.summary.status = 'error'
      this.emit({ type: 'status', sessionId: id, state: 'error' })
      this.emit({ type: 'error', code: 'nano.prompt', message: messageOf(error), retryable: true })
    }
    return { messageId }
  }

  async cancel(id: string): Promise<void> {
    const state = this.ensure(id)
    state.summary.status = 'idle'
    state.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId: id, state: 'idle' })
    try {
      await cancelTurn(id)
    } catch (error) {
      this.emit({ type: 'error', code: 'nano.cancel', message: messageOf(error), retryable: true })
    }
  }

  async answerApproval(approvalId: string, outcome: ApprovalOutcome): Promise<void> {
    const sessionId = this.approvalSessions.get(approvalId)
    this.approvalSessions.delete(approvalId)
    if (sessionId === undefined) return
    try {
      await decideConfirmation(sessionId, approvalId, outcome === 'allowed-once' ? 'allow' : 'deny', outcome)
    } catch (error) {
      this.emit({ type: 'error', code: 'nano.approval', message: messageOf(error), retryable: true })
    }
  }

  async answerQuestion(): Promise<void> {
    // nano-agent's current public surface has no question round-trip.
  }

  clear(): void {
    for (const stream of this.streams.values()) stream.close()
    this.streams.clear()
    this.sessions.clear()
  }

  signOut(): void {
    this.clear()
    clearAuth()
  }

  private readonly approvalSessions = new Map<string, string>()

  private ensure(id: string): NanoSessionState {
    const existing = this.sessions.get(id)
    if (existing !== undefined) return existing
    const summary: SessionSummary = {
      id,
      title: '新会话',
      updatedAt: Date.now(),
      status: 'idle',
      lastMessage: 'nano-agent 会话',
      messageCount: 0,
    }
    return this.ensureState(summary)
  }

  private ensureState(summary: SessionSummary): NanoSessionState {
    const state: NanoSessionState = {
      summary,
      remoteStatus: 'active',
      cursor: 0,
      started: true,
      loaded: false,
      items: [],
      seq: 0,
      assistantSeq: 0,
      assistantText: '',
      assistantThinking: '',
      tools: new Map(),
    }
    this.sessions.set(summary.id, state)
    return state
  }

  private snapshot(state: NanoSessionState): SessionSnapshot {
    return {
      sessionId: state.summary.id,
      cursor: state.cursor,
      status: state.summary.status,
      items: [...state.items],
      hasMore: false,
    }
  }

  private async loadHistory(id: string): Promise<void> {
    const state = this.ensure(id)
    const history = await fetchHistory(id)
    state.items = historyItems(history)
    state.seq = state.items.reduce((max, item) => Math.max(max, item.seq), state.seq)
    if (typeof history.last_event_seq === 'number') state.cursor = Math.max(state.cursor, history.last_event_seq)
    state.loaded = true
    state.summary.messageCount = state.items.length
    const last = state.items[state.items.length - 1]
    if (last !== undefined) {
      if (last.kind === 'user_message' || last.kind === 'assistant_message') {
        state.summary.lastMessage = last.text.slice(0, 80)
      }
      state.summary.updatedAt = Date.now()
    }
    this.emit({
      type: 'session.snapshot',
      sessionId: id,
      cursor: state.cursor,
      status: state.summary.status,
      items: [...state.items],
      hasMore: false,
    })
  }

  private attach(id: string): void {
    if (this.streams.has(id)) return
    try {
      const stream = connectNanoStream(id, this.sessions.get(id)?.cursor ?? 0, {
        onFrame: (frame) => this.handleFrame(id, frame),
        onState: (status) => {
          if (status === 'open') {
            const state = this.sessions.get(id)
            if (state !== undefined && state.remoteStatus === 'detached') state.remoteStatus = 'active'
          }
        },
        onError: (error) => {
          this.emit({ type: 'error', code: error.code, message: error.message, retryable: true })
        },
      })
      this.streams.set(id, stream)
    } catch (error) {
      this.emit({ type: 'error', code: 'nano.stream', message: messageOf(error), retryable: true })
    }
  }

  private detach(id: string): void {
    const stream = this.streams.get(id)
    if (stream === undefined) return
    stream.close()
    this.streams.delete(id)
  }

  private ignoredTransportFrames = 0
  private readonly remoteReceipts = new Map<string, Record<string, unknown>>()

  private handleFrame(id: string, frame: NanoFrame): void {
    if (frame.kind === 'session.heartbeat' || frame.kind === 'session.pong') {
      this.ignoredTransportFrames += 1
      return
    }
    if (frame.kind === 'session.confirmation.request') {
      this.handleConfirmation(id, frame)
      return
    }
    if (frame.kind === 'session.confirmation.update') {
      const confirmationId = typeof frame.confirmation_uuid === 'string' ? frame.confirmation_uuid : ''
      if (confirmationId.length > 0) this.emit({ type: 'approval.cancel', approvalId: confirmationId })
      this.approvalSessions.delete(confirmationId)
      return
    }
    if (frame.kind === 'terminal') {
      this.finishTurn(id)
      return
    }
    if (frame.kind === 'session.replay.lost') {
      void this.loadHistory(id)
      return
    }
    if (frame.kind === 'event' && frame.payload !== undefined) {
      this.projectRemote(id, frame.payload)
      return
    }
    if (typeof frame.kind === 'string') this.projectRemote(id, frame as unknown as Record<string, unknown>)
  }

  /** 业务帧先进 adapter。未知 kind 可见为 system.notify，不吞掉。不写 episodes。 */
  private projectRemote(id: string, payload: Record<string, unknown>): void {
    this.remoteReceipts.set(id, projectReceipt(payload))
    try {
      const event = toCanonical({ ...payload, session_uuid: id })
      this.handleStreamEvent(id, event as unknown as Record<string, unknown>)
    } catch {
      const kind = typeof payload.kind === 'string' ? payload.kind : 'unknown'
      this.handleStreamEvent(id, { kind: 'system.notify', severity: 'info', message: kind, reason: 'absent' })
    }
  }

  private handleStreamEvent(id: string, payload: Record<string, unknown>): void {
    const kind = typeof payload.kind === 'string' ? payload.kind : ''
    const state = this.ensure(id)
    if (kind === 'turn.begin') {
      state.summary.status = 'running'
      this.emit({ type: 'status', sessionId: id, state: 'running' })
      return
    }
    if (kind === 'turn.end') {
      const status = typeof payload.status === 'string' ? payload.status : ''
      if (status === 'error') {
        state.summary.status = 'error'
        this.emit({ type: 'status', sessionId: id, state: 'error' })
      } else {
        this.finishTurn(id)
      }
      void this.loadHistory(id)
      return
    }
    if (kind === 'llm.delta') {
      this.handleLlmDelta(id, payload)
      return
    }
    if (kind === 'tool.call.progress') {
      const name = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
      const chunk = typeof payload.chunk === 'string' ? payload.chunk : ''
      this.updateTool(state, name, chunk, 'running')
      return
    }
    if (kind === 'tool.call.result') {
      this.finishTool(state, payload)
      return
    }
    if (kind === 'tool.call.cancelled') {
      const name = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
      this.updateTool(state, name, '工具已取消', 'error')
      return
    }
    if (kind === 'system.notify' || kind === 'system.error') {
      const level = kind === 'system.error' ? 'error' : (typeof payload.severity === 'string' ? payload.severity : 'info')
      const message = typeof payload.message === 'string' ? payload.message : kind
      this.append(state, {
        kind: 'notice',
        id: randomId('notice'),
        seq: this.nextSeq(state),
        level: level === 'error' ? 'error' : level === 'warning' || level === 'warn' ? 'warn' : 'info',
        text: message,
      })
      if (kind === 'system.error') {
        state.summary.status = 'error'
        this.emit({ type: 'status', sessionId: id, state: 'error' })
      }
      return
    }
    if (kind === 'session.update') {
      const phase = typeof payload.phase === 'string' ? payload.phase : ''
      const running = phase === 'turn_running' || phase === 'compact_running'
      state.summary.status = running ? 'running' : 'idle'
      this.emit({ type: 'status', sessionId: id, state: state.summary.status })
      return
    }
    try {
      const derived = derive({ ...payload, kind: kind as 'tool.call', session_uuid: id })
      if (derived.surface === 'chat-item') {
        this.append(state, { ...derived.item, id: derived.item.id || randomId('remote'), seq: this.nextSeq(state) })
      } else if (derived.event.type === 'status' || derived.event.type === 'assistant.delta' || derived.event.type === 'error') {
        this.emit(derived.event.type === 'status' || derived.event.type === 'assistant.delta'
          ? { ...derived.event, sessionId: id }
          : derived.event)
      }
    } catch {
      this.append(state, {
        kind: 'notice',
        id: randomId('notice'),
        seq: this.nextSeq(state),
        level: 'info',
        text: kind || 'unknown',
      })
    }
  }

  private handleLlmDelta(id: string, payload: Record<string, unknown>): void {
    const state = this.ensure(id)
    const contentType = typeof payload.content_type === 'string' ? payload.content_type : 'text'
    const content = typeof payload.content === 'string' ? payload.content : ''

    if (contentType === 'tool_use_start') {
      const parsed = parseToolArgs(content)
      const name = parsed.name
      const detail = parsed.arguments
      const item: ChatItem = {
        kind: 'tool_call',
        id: randomId('tool'),
        seq: this.nextSeq(state),
        tool: name,
        status: 'running',
        title: name,
        detail,
        args: detail,
      }
      state.tools.set(name, { id: item.id, seq: item.seq, name, detail, status: 'running' })
      this.append(state, item)
      return
    }
    if (contentType === 'tool_use_delta') {
      const tool = [...state.tools.values()].reverse()[0]
      if (tool !== undefined) {
        tool.detail += content
        this.replaceTool(state, tool)
      }
      return
    }
    if (contentType === 'thinking') {
      state.assistantThinking += content
    } else {
      state.assistantText += content
    }
    this.ensureAssistant(state)
    this.scheduleAssistantFlush(id, state)
  }

  private ensureAssistant(state: NanoSessionState): void {
    if (state.assistantId !== undefined) return
    const seq = this.nextSeq(state)
    state.assistantId = randomId('msg')
    state.assistantSeq = seq
    const item: ChatItem = {
      kind: 'assistant_message',
      id: state.assistantId,
      seq,
      text: '',
      html: '',
      thinking: state.assistantThinking || undefined,
    }
    state.items.push(item)
    this.emit({ type: 'item.append', sessionId: state.summary.id, seq, item })
  }

  private scheduleAssistantFlush(id: string, state: NanoSessionState): void {
    if (state.flushTimer !== undefined) return
    state.flushTimer = setTimeout(() => {
      state.flushTimer = undefined
      if (state.assistantId === undefined) return
      const text = state.assistantText
      const item: ChatItem = {
        kind: 'assistant_message',
        id: state.assistantId,
        seq: state.assistantSeq,
        text,
        html: markdownToHtml(text),
        thinking: state.assistantThinking || undefined,
      }
      const index = state.items.findIndex((candidate) => candidate.id === state.assistantId)
      if (index >= 0) state.items[index] = item
      this.emit({ type: 'item.replace', sessionId: id, seq: item.seq, item })
      state.summary.lastMessage = text.slice(0, 80)
      state.summary.updatedAt = Date.now()
    }, 60)
  }

  private updateTool(
    state: NanoSessionState,
    name: string,
    chunk: string,
    status: 'running' | 'ok' | 'error',
  ): void {
    const tool = state.tools.get(name)
    if (tool === undefined) return
    tool.detail += chunk
    tool.status = status
    this.replaceTool(state, tool)
  }

  private replaceTool(state: NanoSessionState, tool: NanoToolState): void {
    const item: ChatItem = {
      kind: 'tool_call',
      id: tool.id,
      seq: tool.seq,
      tool: tool.name,
      status: tool.status,
      title: tool.name,
      detail: tool.detail,
      args: tool.detail,
    }
    const index = state.items.findIndex((candidate) => candidate.id === tool.id)
    if (index >= 0) state.items[index] = item
    this.emit({ type: 'item.replace', sessionId: state.summary.id, seq: item.seq, item })
  }

  private finishTool(state: NanoSessionState, payload: Record<string, unknown>): void {
    const name = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
    const status = typeof payload.status === 'string' ? payload.status : ''
    const output = typeof payload.output === 'string' ? payload.output : ''
    const errorMessage = typeof payload.error_message === 'string' ? payload.error_message : ''
    const failed = status === 'failed' || status === 'error' || errorMessage.length > 0
    const tool = state.tools.get(name)
    if (tool !== undefined) {
      tool.status = failed ? 'error' : 'ok'
      tool.detail = failed ? errorMessage : output || tool.detail
      this.replaceTool(state, tool)
      state.tools.delete(name)
    }
    this.append(state, {
      kind: 'tool_result',
      id: randomId('result'),
      seq: this.nextSeq(state),
      tool: name,
      status: failed ? 'error' : 'ok',
      summary: failed ? errorMessage || '工具失败' : output.slice(0, 160) || '工具已完成',
      detail: failed ? errorMessage : output,
    })
  }

  private finishTurn(id: string): void {
    const state = this.ensure(id)
    if (state.flushTimer !== undefined) {
      clearTimeout(state.flushTimer)
      state.flushTimer = undefined
    }
    if (state.assistantId !== undefined) {
      const item: ChatItem = {
        kind: 'assistant_message',
        id: state.assistantId,
        seq: state.assistantSeq,
        text: state.assistantText,
        html: markdownToHtml(state.assistantText),
        thinking: state.assistantThinking || undefined,
      }
      const index = state.items.findIndex((candidate) => candidate.id === state.assistantId)
      if (index >= 0) state.items[index] = item
      this.emit({ type: 'item.replace', sessionId: id, seq: item.seq, item })
      this.emit({ type: 'assistant.settle', sessionId: id, seq: item.seq, messageId: item.id })
    }
    state.assistantId = undefined
    state.assistantSeq = 0
    state.assistantText = ''
    state.assistantThinking = ''
    state.tools.clear()
    state.summary.status = 'idle'
    state.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId: id, state: 'idle' })
  }

  private handleConfirmation(id: string, frame: NanoFrame): void {
    const confirmationId = typeof frame.confirmation_uuid === 'string' ? frame.confirmation_uuid : ''
    if (confirmationId.length === 0) return
    const payload = frame.payload ?? {}
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
    const callId = typeof frame.request_uuid === 'string' ? frame.request_uuid : undefined
    const approval: ApprovalRequest = {
      id: confirmationId,
      sessionId: id,
      toolName,
      reason: typeof payload.reason === 'string' ? payload.reason : JSON.stringify(payload.tool_input ?? {}).slice(0, 400),
      callId,
      createdAt: Date.now(),
    }
    this.approvalSessions.set(confirmationId, id)
    this.emit({ type: 'approval.request', approval })
  }

  private append(state: NanoSessionState, item: ChatItem): void {
    state.items.push(item)
    state.seq = Math.max(state.seq, item.seq)
    state.summary.messageCount = state.items.length
    state.summary.updatedAt = Date.now()
    this.emit({ type: 'item.append', sessionId: state.summary.id, seq: item.seq, item })
  }

  private nextSeq(state: NanoSessionState): number {
    state.seq += 1
    return state.seq
  }

  private emit(event: LocalEvent): void {
    // 单监听器抛错不得波及其余订阅方（kernel/local/fx emit 同构，审查十四轮 L9）。
    for (const listener of this.listeners) {
      try { listener(event) } catch (e) { console.warn('[nano-runtime] listener 抛错:', e instanceof Error ? e.message : e) }
    }
  }
}

function parseToolArgs(content: string): { name: string; arguments: string } {
  try {
    const value = JSON.parse(content) as Record<string, unknown>
    const name = typeof value.name === 'string' ? value.name : 'tool'
    const args = value.arguments === undefined ? '' : JSON.stringify(value.arguments, null, 2)
    return { name, arguments: args }
  } catch {
    return { name: 'tool', arguments: content }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'nano-agent 请求失败'
}

export const nanoRuntime = new NanoRuntime()
