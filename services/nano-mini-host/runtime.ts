/**
 * kernelRuntime —— nano-mini host 的 mp 宿主 AgentRuntime 实现。
 * bindRuntime（session-store.ts:97-99）本地车道默认：kernel 可用即用，
 * fxLegacy knob 或不可用时回 fxRuntime/localRuntime（T-O-1）。
 * 事件投影：io.llm 文本→assistant.delta/settle；io.tool→tool_call/tool_result 行。
 */

import type {
  ApprovalOutcome,
  ChatItem,
  ImageRef,
  LocalEvent,
  QuestionAnswer,
  SessionSnapshot,
  SessionSummary,
} from '../../types/protocol'
import { markdownToHtml, plainText } from '../markdown'
import { storage } from '../storage'
import { randomId } from '../../utils/uuid'
import { localCas } from '../state/local-cas'
import { kernelUsable, loadKernelAsync } from './kernel-loader'
import { runPump } from './pump'
import { createIoTool } from './io/tool'
import { createIoLlm } from './io/llm'
import type { Io } from './types'

declare const require: (path: string) => unknown

interface StoredSession {
  summary: SessionSummary
  cursor: number
  items: ChatItem[]
}

/** app.json dsh.fxLegacy knob（route.ts knobFromAppJson 同款读取）。 */
function fxLegacyKnob(): boolean {
  try {
    const appJson = require('../../app.json') as { dsh?: { fxLegacy?: boolean } }
    return appJson?.dsh?.fxLegacy === true
  } catch {
    return false
  }
}

/** 跨轮历史：转录本中 user/assistant 文本行，截尾去本轮 input（已入 turn.messages），限量 20 条。 */
function historyMessages(s: StoredSession): Array<{ role: string; content: string }> {
  const msgs = s.items
    .filter((i) => i.kind === 'user_message' || i.kind === 'assistant_message')
    .map((i) => ({ role: i.kind === 'user_message' ? 'user' : 'assistant', content: i.text }))
  return msgs.slice(0, -1).slice(-20)
}

export class KernelMiniRuntime {
  private readonly sessions = new Map<string, StoredSession>()
  private readonly listeners = new Set<(event: LocalEvent) => void>()
  private readonly cancelled = new Set<string>()
  private readonly running = new Set<string>()

  constructor() {
    const saved = storage.getSessions<StoredSession>()
    if (saved !== undefined) {
      for (const s of saved) {
        if (s.summary.status === 'running') s.summary.status = 'idle'
        this.sessions.set(s.summary.id, s)
      }
    }
  }

  static isUsable(): boolean {
    return kernelUsable() && !fxLegacyKnob()
  }

  subscribe(listener: (event: LocalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .map((s) => ({ ...s.summary }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  open(id: string): SessionSnapshot {
    const s = this.require(id)
    return { sessionId: id, cursor: s.cursor, status: s.summary.status, items: [...s.items], hasMore: false }
  }

  create(): SessionSummary {
    const summary: SessionSummary = {
      id: randomId('session'), title: '新会话', updatedAt: Date.now(),
      status: 'idle', lastMessage: '开始一个新的对话', messageCount: 0,
    }
    this.sessions.set(summary.id, { summary, cursor: 0, items: [] })
    this.persist()
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
    this.sessions.delete(id)
    this.persist()
  }

  async prompt(id: string, text: string, images: ImageRef[] = []): Promise<{ messageId: string }> {
    const s = this.require(id)
    if (this.running.has(id)) throw new Error('当前会话仍在运行')
    const messageId = randomId('user')
    this.append(id, { kind: 'user_message', id: messageId, seq: this.nextSeq(s), text, images: images.length > 0 ? images : undefined })
    if (s.summary.title === '新会话' && text.trim().length > 0) s.summary.title = text.trim().slice(0, 28)
    s.summary.status = 'running'
    this.emit({ type: 'status', sessionId: id, state: 'running', step: 1 })
    this.persist()
    void this.drive(id, { role: 'user', content: text })
    return { messageId }
  }

  cancel(id: string): void {
    this.cancelled.add(id)
  }

  answerApproval(_approvalId: string, _outcome: ApprovalOutcome): void { /* kernel 审批面后续 AP */ }
  answerQuestion(_questionId: string, _answers: QuestionAnswer[]): void { /* 同上 */ }

  clear(): void {
    this.sessions.clear()
    this.cancelled.clear()
    storage.clearConversations()
  }

  /** kernel pump 驱动一轮 turn；io 回调内投影 UI 事件。 */
  private async drive(sessionId: string, input: unknown): Promise<void> {
    const s = this.require(sessionId)
    this.running.add(sessionId)
    // 真机：kernel 纯资源分包经 preloadRule 异步下载——轮询等可用（最长 20s）
    const bundle = await loadKernelAsync()
    if (bundle === undefined) {
      this.running.delete(sessionId)
      this.fail(sessionId, 'kernel-unavailable', 'kernel 分包不可加载')
      return
    }
    let assistantText = ''
    const io: Io = {
      state: localCas,
      llm: async (messages) => {
        // 跨轮历史 prepend（worker runtime-mainline 同构）：kernel turn.messages
        // 只装当前 turn，历史由宿主从 UI 转录本临时前置、不回写 kernel buffer。
        const out = await createIoLlm()([...historyMessages(s), ...messages])
        if (typeof out.text === 'string' && out.text.length > 0) assistantText += out.text
        return out
      },
      tool: async (name, args) => {
        const toolItem: ChatItem = {
          kind: 'tool_call', id: randomId('tool'), seq: this.nextSeq(s),
          tool: name, status: 'running', title: name,
          detail: JSON.stringify(args ?? {}).slice(0, 200),
        }
        this.append(sessionId, toolItem)
        const res = await createIoTool(sessionId)(name, args)
        this.append(sessionId, {
          kind: 'tool_result', id: randomId('result'), seq: this.nextSeq(s),
          tool: name, status: res.kind === 'error' ? 'error' : 'ok',
          summary: (res.text ?? res.message ?? '').slice(0, 120),
          detail: res.text ?? res.message ?? '',
        })
        return res
      },
    }
    try {
      const r = await runPump(
        { kernel: bundle.kernel, io, owner: 'local', holder: 'mp-foreground' },
        sessionId,
        { input, cancelRequested: () => this.cancelled.has(sessionId) },
      )
      this.running.delete(sessionId)
      this.cancelled.delete(sessionId)
      if (r.outcome === 'completed') {
        this.settleAssistant(sessionId, assistantText)
      } else if (r.outcome === 'suspended') {
        this.append(sessionId, { kind: 'notice', id: randomId('notice'), seq: this.nextSeq(s), level: 'info', text: '本轮已挂起，等待 tick 恢复续跑。' })
        this.idle(sessionId)
      } else if (r.outcome === 'fenced' || r.outcome === 'claim-denied') {
        this.fail(sessionId, r.outcome, `会话写者冲突：${r.rival ?? r.outcome}`)
      } else {
        this.fail(sessionId, r.outcome, `本轮未正常完成：${r.outcome}（${r.trace.slice(-3).join('>')}）`)
      }
    } catch (e) {
      this.running.delete(sessionId)
      this.cancelled.delete(sessionId)
      this.fail(sessionId, 'host-error', e instanceof Error ? e.message : String(e))
    }
  }

  private settleAssistant(sessionId: string, text: string): void {
    const s = this.require(sessionId)
    const body = text.length > 0 ? text : '（本轮无文本输出）'
    const item: ChatItem = {
      kind: 'assistant_message', id: randomId('msg'), seq: this.nextSeq(s),
      text: body, html: markdownToHtml(body),
    }
    this.append(sessionId, item)
    this.emit({ type: 'assistant.settle', sessionId, seq: item.seq, messageId: item.id })
    this.idle(sessionId)
  }

  private idle(sessionId: string): void {
    const s = this.require(sessionId)
    s.summary.status = 'idle'
    s.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId, state: 'idle' })
    this.persist()
  }

  private fail(sessionId: string, code: string, message: string): void {
    const s = this.sessions.get(sessionId)
    if (s !== undefined) {
      s.summary.status = 'error'
      this.persist()
    }
    this.emit({ type: 'status', sessionId, state: 'error' })
    this.emit({ type: 'error', code, message, retryable: true })
  }

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

  private persist(): void {
    storage.setSessions([...this.sessions.values()])
  }

  private emit(event: LocalEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export const kernelRuntime = new KernelMiniRuntime()
