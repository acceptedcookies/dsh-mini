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
import { ioStateFor, ensureDurableTicket } from '../state/provider'
import { hasFreshTicket } from '../fx/ticket'
import { resolveImageParts } from './images'
import { syncTranscript, dropTranscript } from './transcript'
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

/** 跨轮历史：转录本中 user/assistant 行，截尾去本轮 input（已入 turn.messages），限量 20 条。
 *  用户行携带已解析 imageParts（https artifact URL）——前轮图片对后续轮可见（审查 B8）；
 *  data: 内联形态不沉淀（体积+时效面），local 车道跨轮仅文本——登记边界。 */
function historyMessages(s: StoredSession): Array<{ role: string; content: unknown }> {
  const msgs = s.items
    .filter((i) => i.kind === 'user_message' || i.kind === 'assistant_message')
    .map((i) => {
      const role = i.kind === 'user_message' ? 'user' : 'assistant'
      if (i.kind === 'user_message' && i.imageParts !== undefined && i.imageParts.length > 0) {
        const parts = i.imageParts.filter((p) => p.url.startsWith('https://') || p.url.startsWith('http://'))
        if (parts.length > 0) return { role, content: [...parts, ...(i.text.trim().length > 0 ? [{ kind: 'text', text: i.text }] : [])] }
      }
      return { role, content: i.text }
    })
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
    // 远端转录行+本地指针随会话删除清理（best-effort，不阻塞本地删——审查 B8）。
    void dropTranscript(id)
  }

  async prompt(id: string, text: string, images: ImageRef[] = []): Promise<{ messageId: string }> {
    const s = this.require(id)
    if (this.running.has(id)) throw new Error('当前会话仍在运行')
    // 防御性清陈旧 cancel 标记（idle 期误触 cancel 不得吃掉下一轮）。
    this.cancelled.delete(id)
    // 提前占位：resolveImageParts/铸票跨秒级 await——running 只在 drive 置位会让
    // 第二个 prompt 从间隙穿过，同 holder 双泵互扰（审查四轮 F5）。
    this.running.add(id)
    const messageId = randomId('user')
    this.append(id, { kind: 'user_message', id: messageId, seq: this.nextSeq(s), text, images: images.length > 0 ? images : undefined })
    if (s.summary.title === '新会话' && text.trim().length > 0) s.summary.title = text.trim().slice(0, 28)
    s.summary.status = 'running'
    this.emit({ type: 'status', sessionId: id, state: 'running', step: 1 })
    this.persist()
    // 票据前置（用户手势上下文）：云 durable 车道无活票时 resolveImageParts 的
    // publishArtifact 与 runPump claim 同样 401——图片解析在 mint 门之前时冷启动/
    // 过期后图片发送永久失败且永无铸票路径（审查四轮 F1）。
    try {
      await ensureDurableTicket()
    } catch (e) {
      this.running.delete(id)
      this.fail(id, 'ticket-required', e instanceof Error ? e.message : String(e))
      return { messageId }
    }
    // G4：images → kernel image_url parts（cloud=publish→https，local/sim=data: 内联）。
    // 解析失败（远端 lane 缺位/文件读不出）如实上报——不丢图静默跑文本。
    // 已解析 parts 沉淀进 user item（imageParts）——跨轮历史/转录重建用；
    // https artifact URL 内容寻址天然稳定，data: 形态不沉淀（体积+时效）。
    let input: unknown = { role: 'user', content: text }
    if (images.length > 0) {
      try {
        const parts = await resolveImageParts(images)
        const stored = s.items[s.items.length - 1]
        if (stored.kind === 'user_message' && stored.id === messageId) {
          // 只沉淀 https:/http: 形态——data: 内联是数 MB base64，持久化爆
          // wx.storage 10MB 配额并喂大 transcript 行（historyMessages 同样只认远端形态）。
          const durableParts = parts.filter((p) => p.url.startsWith('https://') || p.url.startsWith('http://'))
          if (durableParts.length > 0) {
            stored.imageParts = durableParts
            this.persist()
          }
        }
        input = {
          role: 'user',
          content: [...parts, ...(text.trim().length > 0 ? [{ kind: 'text', text }] : [])],
        }
      } catch (e) {
        this.running.delete(id)
        this.fail(id, 'image-resolve-failed', e instanceof Error ? e.message : String(e))
        return { messageId }
      }
    }
    void this.drive(id, input)
    return { messageId }
  }

  cancel(id: string): void {
    // 仅对进行中的轮有效——idle 期留标记会让下一 prompt 首步即被 cancel 吞掉。
    if (this.running.has(id) || this.sessions.get(id)?.summary.status === 'running') {
      this.cancelled.add(id)
    }
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
    // require 在 try 外会漏 unhandled rejection——会话已在 pump 落地前删除属正常竞态（审查 B8）。
    // prompt 提前占位 running（F5）——此处早退必须释放，否则会话删除后 running 泄漏。
    const s = this.sessions.get(sessionId)
    if (s === undefined) {
      this.running.delete(sessionId)
      return
    }
    this.running.add(sessionId)
    // 真机：kernel 纯资源分包经 preloadRule 异步下载——轮询等可用（最长 20s）
    const bundle = await loadKernelAsync()
    if (bundle === undefined) {
      this.running.delete(sessionId)
      this.fail(sessionId, 'kernel-unavailable', 'kernel 分包不可加载')
      return
    }
    // 云车道票据前置：authHeaders 已改缓存只读（不再铸票）——claim 是 turn 内首个
    // remote 调用，必须先 ready() 铸票，否则冷启动/票据过期后每轮 host-error 401
    // 且永无恢复路径（审查三轮 N1 死锁）。prompt=用户手势上下文允许 SOTER。
    try {
      await ensureDurableTicket()
    } catch (e) {
      this.running.delete(sessionId)
      this.fail(sessionId, 'ticket-required', e instanceof Error ? e.message : String(e))
      return
    }
    let assistantText = ''
    let deltaIndex = 0
    const attemptId = randomId('attempt')
    const io: Io = {
      // durable lane：cloud 路由→remoteCas（POD1），local/sim→localCas（provider.ts 裁决）
      state: ioStateFor(),
      llm: async (messages) => {
        // 跨轮历史 prepend（worker runtime-mainline 同构）：kernel turn.messages
        // 只装当前 turn，历史由宿主从 UI 转录本临时前置、不回写 kernel buffer。
        const out = await createIoLlm()([...historyMessages(s), ...messages])
        if (typeof out.text === 'string' && out.text.length > 0) {
          assistantText += out.text
          // assistant.delta：io.llm 非流式 → delta 粒度=llm_call 步（诚实粒度，
          // 非 token 流）；index 严格递增供 UI/观测做时序断言。
          deltaIndex += 1
          this.emit({ type: 'assistant.delta', sessionId, attemptId, index: deltaIndex, text: out.text })
        }
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
        // confirmation_pending/fatal_error 挂起不落 alarm——无自动复活路径，
        // 只有新 prompt（waiting→input_arrived→resume）能续跑，文案如实说。
        this.append(sessionId, { kind: 'notice', id: randomId('notice'), seq: this.nextSeq(s), level: 'info', text: '本轮已挂起（等待确认或外部输入），发送新消息即可继续。' })
        this.idle(sessionId)
      } else if (r.outcome === 'fenced' || r.outcome === 'claim-denied') {
        this.fail(sessionId, r.outcome, `会话写者冲突：${r.rival ?? r.outcome}`, false)
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
    void this.syncTranscriptNow(sessionId)
  }

  /** G5：转录上行（remote lane 在时）；上行失败不拖累会话——warn 登记。
   *  无活票据跳过（铸票=SOTER 须用户手势；水位指针未动，下次 settle 重推）。 */
  async syncTranscriptNow(sessionId: string): Promise<unknown> {
    const s = this.sessions.get(sessionId)
    if (s === undefined || !hasFreshTicket()) return null
    try {
      return await syncTranscript(sessionId, s.items, { model: storage.getModel() })
    } catch (e) {
      console.warn(`[transcript] sync ${sessionId} 失败（会话不受影响）:`, e instanceof Error ? e.message : e)
      return null
    }
  }

  private idle(sessionId: string): void {
    const s = this.require(sessionId)
    s.summary.status = 'idle'
    s.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId, state: 'idle' })
    this.persist()
  }

  private fail(sessionId: string, code: string, message: string, retryable = true): void {
    const s = this.sessions.get(sessionId)
    if (s !== undefined) {
      s.summary.status = 'error'
      this.persist()
    }
    this.emit({ type: 'status', sessionId, state: 'error' })
    this.emit({ type: 'error', code, message, retryable })
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
    // 单监听器抛错不得波及其余订阅方或回写轮次状态（审查 B8）。
    for (const listener of this.listeners) {
      try { listener(event) } catch (e) { console.warn('[runtime] listener 抛错:', e instanceof Error ? e.message : e) }
    }
  }
}

export const kernelRuntime = new KernelMiniRuntime()
