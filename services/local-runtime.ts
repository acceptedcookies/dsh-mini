import type {
  ApprovalOutcome,
  ChatItem,
  ImageRef,
  LocalEvent,
  QuestionAnswer,
  SessionSnapshot,
  SessionSummary,
} from '../types/protocol'
import { markdownToHtml, plainText } from './markdown'
import { storage } from './storage'
import { randomId } from '../utils/uuid'

interface StoredSession {
  summary: SessionSummary
  cursor: number
  items: ChatItem[]
  toolRuns: number
}

interface PendingApproval {
  approvalId: string
  sessionId: string
  toolItemId: string
  promptText: string
}

function assistantItem(seq: number, text: string, thinking?: string): ChatItem {
  return {
    kind: 'assistant_message',
    id: randomId('msg'),
    seq,
    text,
    html: markdownToHtml(text),
    thinking,
  }
}

function welcomeItems(): ChatItem[] {
  const text = [
    '# DeepSeek Harness',
    '',
    '这是 dsh 的原生微信小程序工作区。会话、流式输出、工具卡片、审批和主题都在小程序内完成，不依赖外部服务。',
    '',
    '你可以：',
    '',
    '- 在左侧切换和新建会话',
    '- 直接输入消息，观察流式回复',
    '- 在工具卡片上查看执行状态',
    '- 在审批面板中允许或拒绝敏感操作',
    '',
    '> 当前是本地运行时。登录 nano-agent 后，这里会显示由 orchestrator 会话流产生的同一套事件。',
  ].join('\n')
  return [assistantItem(1, text, '先确认当前工作区与可用能力，再组织回答。')]
}

function pluginItems(): ChatItem[] {
  const text = [
    '# dsh 的插件架构',
    '',
    'dsh 的每一部分都是 Cordis 插件：模型适配器、工具注册表、会话日志和 agent loop 本身。',
    '',
    '```ts',
    'export const plugin = {',
    '  name: "dsh-mini",',
    '  apply(ctx) {',
    '    ctx.on("session/event", render)',
    '  },',
    '}',
    '```',
    '',
    '小程序端只负责表达：把持久会话事件投影成消息、工具卡片和审批请求。',
  ].join('\n')
  return [assistantItem(1, text)]
}

export class LocalRuntime {
  private readonly sessions = new Map<string, StoredSession>()
  private readonly listeners = new Set<(event: LocalEvent) => void>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()

  constructor() {
    const saved = storage.getSessions<StoredSession>()
    if (saved !== undefined && saved.length > 0) {
      for (const session of saved) this.sessions.set(session.summary.id, session)
    } else {
      this.seed()
    }
  }

  subscribe(listener: (event: LocalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .map((session) => ({ ...session.summary }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  open(id: string): SessionSnapshot {
    const session = this.require(id)
    return {
      sessionId: id,
      cursor: session.cursor,
      status: session.summary.status,
      items: [...session.items],
      hasMore: false,
    }
  }

  create(): SessionSummary {
    const now = Date.now()
    const id = randomId('session')
    const summary: SessionSummary = {
      id,
      title: '新会话',
      updatedAt: now,
      status: 'idle',
      lastMessage: '开始一个新的对话',
      messageCount: 0,
    }
    this.sessions.set(id, { summary, cursor: 0, items: [], toolRuns: 0 })
    this.persist()
    this.emit({ type: 'status', sessionId: id, state: 'idle' })
    return { ...summary }
  }

  rename(id: string, title: string): SessionSummary {
    const session = this.require(id)
    session.summary.title = title
    session.summary.updatedAt = Date.now()
    this.persist()
    return { ...session.summary }
  }

  remove(id: string): void {
    this.sessions.delete(id)
    this.persist()
  }

  prompt(id: string, text: string, images: ImageRef[] = []): { messageId: string } {
    const session = this.require(id)
    if (session.summary.status === 'running') throw new Error('当前会话仍在运行')
    session.summary.status = 'running'
    session.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId: id, state: 'running', step: 1 })

    const messageId = randomId('user')
    this.append(id, {
      kind: 'user_message',
      id: messageId,
      seq: this.nextSeq(session),
      text,
      images: images.length > 0 ? images : undefined,
    })
    if (session.summary.title === '新会话' && text.trim().length > 0) {
      session.summary.title = text.trim().slice(0, 28)
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (session.summary.status !== 'running') return
      if (session.toolRuns === 0) {
        this.askForToolApproval(session, text)
        return
      }
      session.toolRuns += 1
      void this.streamAssistant(id, text)
    }, 320)
    this.timers.add(timer)
    this.persist()
    return { messageId }
  }

  cancel(id: string): void {
    const session = this.require(id)
    for (const timer of this.timers) {
      clearTimeout(timer)
      this.timers.delete(timer)
    }
    session.summary.status = 'idle'
    session.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId: id, state: 'idle' })
    this.emit({ type: 'error', code: 'cancelled', message: '已停止当前轮次', retryable: false })
    this.persist()
  }

  answerApproval(approvalId: string, outcome: ApprovalOutcome): void {
    const pending = this.pendingApprovals.get(approvalId)
    if (pending === undefined) return
    this.pendingApprovals.delete(approvalId)
    const session = this.require(pending.sessionId)
    const allowed = outcome === 'allowed-once'
    const current = session.items.find((item) => item.id === pending.toolItemId)
    if (current?.kind === 'tool_call') {
      this.replace(pending.sessionId, {
        ...current,
        status: allowed ? 'ok' : 'error',
        detail: allowed ? '审批通过，命令已执行' : '审批被拒绝，命令没有执行',
      })
    }
    if (allowed) {
      session.toolRuns += 1
      this.append(pending.sessionId, {
        kind: 'tool_result',
        id: randomId('result'),
        seq: this.nextSeq(session),
        tool: 'shell',
        status: 'ok',
        summary: '2 passed, 0 failed',
        detail: 'PASS tests/session.test.ts\nPASS tests/projection.test.ts',
      })
      void this.streamAssistant(pending.sessionId, pending.promptText, '审批通过。测试已执行：`2 passed, 0 failed`。\n\n')
    } else {
      this.append(pending.sessionId, {
        kind: 'notice',
        id: randomId('notice'),
        seq: this.nextSeq(session),
        level: 'error',
        text: '命令未执行：审批被拒绝。',
      })
      session.summary.status = 'idle'
      this.emit({ type: 'status', sessionId: pending.sessionId, state: 'idle' })
      this.persist()
    }
  }

  answerQuestion(_questionId: string, _answers: QuestionAnswer[]): void {
    // 本地运行时目前只演示审批；提问协议保留给 nano-agent 运行时。
  }

  clear(): void {
    this.sessions.clear()
    this.pendingApprovals.clear()
    storage.clearConversations()
  }

  private seed(): void {
    const now = Date.now()
    const welcome: StoredSession = {
      summary: {
        id: 'welcome',
        title: '欢迎使用 dsh',
        updatedAt: now - 60_000,
        status: 'idle',
        lastMessage: '原生小程序工作区',
        messageCount: 1,
      },
      cursor: 1,
      items: welcomeItems(),
      toolRuns: 1,
    }
    const plugins: StoredSession = {
      summary: {
        id: 'plugins',
        title: '插件架构',
        updatedAt: now - 3_600_000,
        status: 'idle',
        lastMessage: '每一部分都是插件',
        messageCount: 1,
      },
      cursor: 1,
      items: pluginItems(),
      toolRuns: 1,
    }
    this.sessions.set(welcome.summary.id, welcome)
    this.sessions.set(plugins.summary.id, plugins)
    this.persist()
  }

  private askForToolApproval(session: StoredSession, promptText: string): void {
    const id = session.summary.id
    const callId = randomId('call')
    const toolItem: ChatItem = {
      kind: 'tool_call',
      id: randomId('tool'),
      seq: this.nextSeq(session),
      tool: 'shell',
      status: 'running',
      title: 'pnpm test',
      callId,
      detail: '准备在工作区内执行测试命令',
      args: '{"command":"pnpm test"}',
    }
    this.append(id, toolItem)
    const approvalId = randomId('approval')
    this.pendingApprovals.set(approvalId, {
      approvalId,
      sessionId: id,
      toolItemId: toolItem.id,
      promptText,
    })
    this.emit({
      type: 'approval.request',
      approval: {
        id: approvalId,
        sessionId: id,
        toolName: 'shell',
        reason: '需要执行命令：pnpm test',
        callId,
        createdAt: Date.now(),
      },
    })
  }

  private async streamAssistant(sessionId: string, promptText: string, prefix = ''): Promise<void> {
    const session = this.require(sessionId)
    const attemptId = randomId('attempt')
    const text = [
      `${prefix}收到：**${promptText.slice(0, 120)}**`,
      '',
      '这是 dsh 的本地客户端运行时。会话、流式输出和工具卡片都在小程序内完成。',
      '',
      '- 会话状态：`running`',
      '- 渲染方式：流式文本 → Markdown',
      '- 数据位置：本机 `wx.storage`',
      '',
      '```ts',
      'const session = await dsh.sessions.open(id)',
      'for (const event of session.events()) render(event)',
      '```',
      '',
      '登录 nano-agent 后，这里会替换为 WebSocket 会话流的增量事件。',
    ].join('\n')
    const chunks = text.match(/.{1,8}/gs) ?? [text]
    let index = 0
    for (const chunk of chunks) {
      if (session.summary.status !== 'running') return
      this.emit({ type: 'assistant.delta', sessionId, attemptId, index, text: chunk })
      index += 1
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.timers.delete(timer)
          resolve()
        }, 18)
        this.timers.add(timer)
      })
    }
    const item = assistantItem(this.nextSeq(session), text, '分析请求、组织结构，并检查输出格式。')
    this.append(sessionId, item)
    session.summary.status = 'idle'
    session.summary.updatedAt = Date.now()
    this.emit({ type: 'assistant.settle', sessionId, seq: item.seq, messageId: item.id })
    this.emit({ type: 'status', sessionId, state: 'idle' })
    this.persist()
  }

  private require(id: string): StoredSession {
    const session = this.sessions.get(id)
    if (session === undefined) throw new Error('会话不存在')
    return session
  }

  private nextSeq(session: StoredSession): number {
    session.cursor += 1
    return session.cursor
  }

  private append(sessionId: string, item: ChatItem): void {
    const session = this.require(sessionId)
    const stamped: ChatItem = item.ts === undefined ? ({ ...item, ts: Date.now() } as ChatItem) : item
    session.items.push(stamped)
    session.summary.updatedAt = Date.now()
    session.summary.messageCount = session.items.length
    if (stamped.kind === 'assistant_message') session.summary.lastMessage = plainText(stamped.text)
    else if (stamped.kind === 'user_message') session.summary.lastMessage = stamped.text
    this.persist()
    this.emit({ type: 'item.append', sessionId, seq: stamped.seq, item: stamped })
  }

  private replace(sessionId: string, item: ChatItem): void {
    const session = this.require(sessionId)
    const index = session.items.findIndex((candidate) => candidate.id === item.id)
    const previous = index === -1 ? undefined : session.items[index]
    const stamped: ChatItem = item.ts === undefined
      ? ({ ...item, ts: previous?.ts ?? Date.now() } as ChatItem)
      : item
    if (index !== -1) session.items[index] = stamped
    session.summary.updatedAt = Date.now()
    this.persist()
    this.emit({ type: 'item.replace', sessionId, seq: stamped.seq, item: stamped })
  }

  private persist(): void {
    storage.setSessions([...this.sessions.values()])
  }

  private emit(event: LocalEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export const localRuntime = new LocalRuntime()
