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
import { reportSilent } from '../error-report'
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
        // 进程中断轮残留 running 工具卡——重启归一 error 并落中断注记，
        // 不转永转的幽灵卡（UI 审查 F6）。
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
    // 在飞轮次先撤——删除不取消会让 pump 继续烧 llm 直至 require 抛错，
    // 随后 fail 向当前界面发 'host-error: 会话不存在' 幽灵横幅（UI 审查 F5）。
    this.cancelled.add(id)
    this.sessions.delete(id)
    this.persist()
    // 远端转录行+本地指针随会话删除清理（best-effort，不阻塞本地删——审查 B8）。
    void dropTranscript(id)
    // durable 泵态同行清理：state/claim/alarm 行不随 sessions.delete 走——
    // 残留行让 in-flight pump 继续写孤儿快照、残留 alarm 让 sweep 对死会话
    // 空跑满步（审查十四轮 M1）。best-effort：远端 del 为记录 no-op 不阻塞。
    void this.dropPumpRows(id)
  }

  /** kernel 泵的 durable 行（state/claims/alarms 下 owner='local'）——删除/清空共用。 */
  private async dropPumpRows(sessionId: string): Promise<void> {
    try {
      const st = ioStateFor()
      await st.del(`dsh-mini/state/local/${sessionId}`)
      await st.del(`dsh-mini/claims/local/${sessionId}`)
      const rows = await st.listPrefix('dsh-mini/alarms/local/')
      for (const k of rows) {
        if (k.endsWith(`-${sessionId}`)) await st.del(k)
      }
    } catch (e) {
      console.warn(`[runtime] pump 行清理 ${sessionId} 失败（best-effort）:`, e instanceof Error ? e.message : e)
      reportSilent(e, { op: 'pump-rows-drop', lane: 'background', sessionId })
    }
  }

  clear(): void {
    // 清空前先对在飞轮次武装撤标——sessions.clear 后 pump 的下一步 saveSnap/
    // io 调用仍在跑，cancelRequested 探测是它们唯一的停下信号（审查十四轮 H2）。
    // cancelled 故意不清：标记是删后会话的撤停信号，prompt() 对活会话有防御性清。
    for (const id of this.running) this.cancelled.add(id)
    for (const s of this.sessions.values()) {
      if (s.summary.status === 'running') this.cancelled.add(s.summary.id)
    }
    this.sessions.clear()
    storage.clearConversations()
    // 泵态键区整清（state/claims/alarms under owner='local'）+ 本地指针/
    // pending-catchup——旧实现只清 UI 存储，在飞泵与 alarm 行原样存活（H2）。
    void this.dropAllPumpRows()
    try {
      const keys = (wx.getStorageInfoSync().keys as string[]).filter((k) => k.startsWith('dsh:mini:session-ptr:') || k === 'dsh:mini:pending-catchup')
      for (const k of keys) wx.removeStorageSync(k)
    } catch (e) {
      console.warn('[runtime] clear 指针键清理失败（best-effort）:', e instanceof Error ? e.message : e)
      reportSilent(e, { op: 'ptr-keys-clear', lane: 'background' })
    }
  }

  private async dropAllPumpRows(): Promise<void> {
    try {
      const st = ioStateFor()
      for (const prefix of ['dsh-mini/state/local/', 'dsh-mini/claims/local/', 'dsh-mini/alarms/local/']) {
        const rows = await st.listPrefix(prefix)
        for (const k of rows) await st.del(k)
      }
    } catch (e) {
      console.warn('[runtime] clear 泵态键区清理失败（best-effort）:', e instanceof Error ? e.message : e)
      reportSilent(e, { op: 'pump-rows-clear', lane: 'background' })
    }
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
    const prevTitle = s.summary.title
    const prevLast = s.summary.lastMessage
    try {
      this.append(id, { kind: 'user_message', id: messageId, seq: this.nextSeq(s), text, images: images.length > 0 ? images : undefined })
      if (s.summary.title === '新会话' && text.trim().length > 0) s.summary.title = text.trim().slice(0, 28)
      s.summary.status = 'running'
      this.emit({ type: 'status', sessionId: id, state: 'running', step: 1 })
      this.persist()
    } catch (e) {
      // append/persist 的 wx.setStorageSync 可抛配额——running 已提前占位，
      // 不释放会让会话终身不可 prompt（审查五轮）；已入队 user 行与 title/
      // lastMessage 同步回滚，不留半落账假象（审查十四轮 M3）。
      const idx = s.items.findIndex((i) => i.id === messageId)
      if (idx !== -1) s.items.splice(idx, 1)
      s.summary.messageCount = s.items.length
      s.summary.title = prevTitle
      s.summary.lastMessage = prevLast
      s.summary.status = 'idle'
      this.running.delete(id)
      throw e
    }
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
      // 取消是步边界语义（kernel 步内不可中断）——立即落账一条注记，
      // 用户拿到确认反馈而非干等本轮结束（审查十四轮 M6）。配额抛不影响撤标。
      try {
        this.append(id, { kind: 'notice', id: randomId('notice'), seq: this.nextSeq(this.require(id)), level: 'info', text: '已请求停止，将在当前步骤完成后停止。' })
      } catch { /* 撤标已在内存生效，注记尽力即可 */ }
    }
  }

  answerApproval(_approvalId: string, _outcome: ApprovalOutcome): void { /* kernel 审批面后续 AP */ }
  answerQuestion(_questionId: string, _answers: QuestionAnswer[]): void { /* 同上 */ }

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
        // noMint：铸票已在 drive 手势面完成——轮中票据过期的 ready() 会在
        // 后台上下文弹 SOTER（审查十四轮 L2），如实 401→host-error 更诚实。
        const out = await createIoLlm({ noMint: true })([...historyMessages(s), ...messages])
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
        // 工具卡必须终态化——running 残留会被构造面中断归一错判（全部历史卡
        // 变 error+幽灵注记，审查八轮 D1）；fx 车道经 tool_call_update 同构。
        let res: Awaited<ReturnType<ReturnType<typeof createIoTool>>>
        try {
          res = await createIoTool(sessionId)(name, args)
        } catch (e) {
          this.replace(sessionId, { ...toolItem, status: 'error', detail: e instanceof Error ? e.message : String(e) })
          throw e
        }
        this.replace(sessionId, { ...toolItem, status: res.kind === 'error' ? 'error' : 'ok' })
        // detail 上限 4KB：无界 detail 会随 persist/转录上行放大成 wx.storage
        // 配额爆与 >8MB overflow 丢行（审查十四轮 M4）。显示面有 summary 兜底。
        this.append(sessionId, {
          kind: 'tool_result', id: randomId('result'), seq: this.nextSeq(s),
          tool: name, status: res.kind === 'error' ? 'error' : 'ok',
          summary: (res.text ?? res.message ?? '').slice(0, 120),
          detail: (res.text ?? res.message ?? '').slice(0, 4096),
        })
        return res
      },
    }
    try {
      // cancel 在票据/分包等待期落地时不得空跑整轮——预检直接收尾（审查十四轮 M6）。
      if (this.cancelled.has(sessionId)) {
        this.running.delete(sessionId)
        this.cancelled.delete(sessionId)
        this.idle(sessionId)
        return
      }
      const r = await runPump(
        { kernel: bundle.kernel, io, owner: 'local', holder: 'mp-foreground' },
        sessionId,
        { input, cancelRequested: () => this.cancelled.has(sessionId) },
      )
      // 取消标记必须在 delete 前快照——cancel 完成的轮以 'completed' 返回，
      // 空文本 settle 会产 '（本轮无文本输出）' 垃圾行（审查十四轮 M6）。
      const wasCancelled = this.cancelled.has(sessionId)
      this.running.delete(sessionId)
      this.cancelled.delete(sessionId)
      // durable 快照腐坏被按新会话重建（M5）——执行态丢转录在，落账注记不静默。
      if (r.reset === true && this.sessions.has(sessionId)) {
        try {
          this.append(sessionId, { kind: 'notice', id: randomId('notice'), seq: this.nextSeq(s), level: 'warn', text: '（会话执行状态已重置：旧检查点不可恢复，本轮从新状态继续）' })
        } catch { /* 注记尽力即可 */ }
      }
      if (r.outcome === 'completed') {
        this.settleAssistant(sessionId, assistantText, wasCancelled)
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
      const msg = e instanceof Error ? e.message : String(e)
      // 413=checkpoint 超存储上限：同一会话每轮必复现且无 compaction，
      // 如实区分文案+不可重试——恢复路径（新快照面）登记为业主决定（审查十四轮 M4b）。
      const tooBig = msg.includes('saveSnap putCas 413')
      this.fail(sessionId, 'host-error',
        tooBig ? '会话 durable 状态超出存储上限（kernel checkpoint 超限），本轮不可续，建议新建会话。' : msg,
        !tooBig)
    }
  }

  private settleAssistant(sessionId: string, text: string, wasCancelled = false): void {
    const s = this.require(sessionId)
    // 取消完成的轮无部分文本时跳过 assistant 行——'（本轮无文本输出）'
    // 是误导性垃圾（用户主动停的）；cancel() 已落'已请求停止'注记（M6）。
    if (!(wasCancelled && text.length === 0)) {
      const body = text.length > 0 ? text : '（本轮无文本输出）'
      const item: ChatItem = {
        kind: 'assistant_message', id: randomId('msg'), seq: this.nextSeq(s),
        text: body, html: markdownToHtml(body),
      }
      this.append(sessionId, item)
      this.emit({ type: 'assistant.settle', sessionId, seq: item.seq, messageId: item.id })
    }
    this.idle(sessionId)
    void this.syncTranscriptNow(sessionId)
  }

  /** G5：转录上行（remote lane 在时）；上行失败不拖累会话——warn 登记。
   *  无活票据跳过（铸票=SOTER 须用户手势；水位指针未动，下次 settle 重推）。 */
  async syncTranscriptNow(sessionId: string): Promise<unknown> {
    const s = this.sessions.get(sessionId)
    if (s === undefined || !hasFreshTicket()) return null
    try {
      // 删除竞态：sync 进行中被删，继续推行会把已删会话在远端复活（审查十四轮
      // M7）。shouldStop 逐行闸 + 收尾复检后补 dropTranscript（drop 先行已删的
      // 行被后推复活，二次 drop 兜底）。
      const r = await syncTranscript(sessionId, s.items, { model: storage.getModel() }, () => !this.sessions.has(sessionId))
      if (!this.sessions.has(sessionId)) void dropTranscript(sessionId)
      return r
    } catch (e) {
      console.warn(`[transcript] sync ${sessionId} 失败（会话不受影响）:`, e instanceof Error ? e.message : e)
      // 上行失败 fire-and-forget（later settlement 重试）——silent 台账供诊断聚合。
      reportSilent(e, { op: 'transcript-sync', lane: 'background', sessionId })
      return null
    }
  }

  private idle(sessionId: string): void {
    const s = this.require(sessionId)
    s.summary.status = 'idle'
    s.summary.updatedAt = Date.now()
    this.emit({ type: 'status', sessionId, state: 'idle' })
    // 状态迁移已内存落位——持久化尽力即可：配额抛不得逃逸成 void drive()
    // 链的 unhandled rejection 或掩盖上游真实错误路径（审查六轮）。
    try { this.persist() } catch (e) { console.warn('[runtime] idle persist 失败:', e instanceof Error ? e.message : e) }
  }

  private fail(sessionId: string, code: string, message: string, retryable = true): void {
    const s = this.sessions.get(sessionId)
    if (s === undefined) {
      // 已删会话的迟到失败不发全局横幅——删除竞态噪声不上用户当前界面（UI 审查 F5）。
      console.warn(`[runtime] fail(${code}) on deleted session ${sessionId}: ${message}`)
      return
    }
    s.summary.status = 'error'
    try { this.persist() } catch (e) { console.warn('[runtime] fail persist 失败:', e instanceof Error ? e.message : e) }
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

  private emit(event: LocalEvent): void {
    // 单监听器抛错不得波及其余订阅方或回写轮次状态（审查 B8）。
    for (const listener of this.listeners) {
      try { listener(event) } catch (e) { console.warn('[runtime] listener 抛错:', e instanceof Error ? e.message : e) }
    }
  }
}

export const kernelRuntime = new KernelMiniRuntime()
