/**
 * pump —— kernel 决策环 + fragment CAS 持久化 + claim 单写者 + alarm 缝。
 * kernel-do.mjs:64-125 spike 产品化（EM-N1~N4 已证）。
 * kernel 模块注入（mp 经 subpkg/kernel/kernel.js、sweeper 经 vendor/kernel.cjs），
 * Io{llm,tool,state} 注入（T-O-3：mp 与 sweeper 共享同一份 pump）。
 */

import type {
  AlarmRecord,
  EpisodeLedgerRow,
  EpisodeRef,
  Io,
  KernelModule,
  KernelSnapshot,
  PumpOptions,
  PumpResult,
  SchedulerSignals,
  StepDecision,
  SweepResult,
} from './types'
import { errorBus, reportSilent } from '../error-report'
import { randomUUID } from '../crypto/random'
import { assemble } from '../context/assemble'
import { evaluateCompact, foldTranscript, protectedTail } from '../context/compact-policy'
import type { LlmChunk, LlmOutput, LlmToolCall } from './types'

const ST = 'dsh-mini/state'
const CL = 'dsh-mini/claims'
const AL = 'dsh-mini/alarms'
const EP = 'dsh-mini/episodes'

/** 事件 uuid：只走 services/crypto/random.ts。两源皆无时向上抛，不改回伪随机。 */
const evUuid = (): string => randomUUID()

const lastUsage = new Map<string, { inputTokens?: number; outputTokens?: number }>()

async function readLlm(stream: AsyncIterable<LlmChunk>): Promise<LlmOutput> {
  let text = ''
  let sawText = false
  const toolCalls: LlmToolCall[] = []
  let usage: LlmOutput['usage']
  for await (const chunk of stream) {
    if (chunk.kind === 'content') {
      sawText = true
      text += chunk.text
    } else if (chunk.kind === 'usage') {
      usage = chunk.usage
    } else if (chunk.kind === 'tool_call') {
      toolCalls.push(chunk.call)
    } else if (chunk.kind === 'error') {
      throw new Error(chunk.message)
    }
  }
  return {
    text: sawText ? text : null,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    ...(usage !== undefined ? { usage } : {}),
  }
}

/** snapshot 行内嵌 ep 段的 pending 事件上限：防长 episode 逼近 256KB 行上限；
 *  溢出如实计数（dropped），回放 artifact 记录 drop 数——不静默丢。 */
const EP_EVENTS_CAP = 256

export interface PumpCtx {
  kernel: KernelModule
  io: Io
  owner: string // openid；本地车道固定 'local'
  holder: string
}

interface ClaimOutcome {
  status: number
  holder?: string
}

async function claim(ctx: PumpCtx, sessionId: string, ttlMs: number): Promise<ClaimOutcome> {
  const key = `${CL}/${ctx.owner}/${sessionId}`
  const row = await ctx.io.state.get(key)
  if (row !== null) {
    try {
      const c = JSON.parse(row.body) as { holder: string; expires: string }
      if (c.holder !== ctx.holder && Date.parse(c.expires) > Date.now()) {
        return { status: 412, holder: c.holder }
      }
    } catch { /* 坏行视为可覆盖 */ }
  }
  const body = JSON.stringify({ holder: ctx.holder, expires: new Date(Date.now() + ttlMs).toISOString() })
  // 过期/自持行接管必须条件写：防读-改-写竞态（TOCTOU）下双 holder。
  const r = await ctx.io.state.putCas(key, body, row !== null ? { ifMatch: row.etag } : { ifNoneMatch: '*' })
  return r.status === 200 ? { status: 200 } : { status: 412 }
}

async function loadSnap(ctx: PumpCtx, sessionId: string): Promise<{ snap: KernelSnapshot | null; etag: string | null; ep: EpisodeRef | null; reset?: boolean }> {
  const row = await ctx.io.state.get(`${ST}/${ctx.owner}/${sessionId}`)
  if (row === null) return { snap: null, etag: null, ep: null }
  // 腐行/版本错位（KERNEL_VERSION 升级、JSON 截断、zod 失格）不得永砖会话——
  // 原样传播会让每次 prompt 同点抛出且无复位路径（审查十四轮 M5）。
  // 如实 warn 后按空快照重建：kernel 状态丢但 UI 转录在 s.items 保留；
  // saveSnap 持既有 etag 覆写同键（旧行不复存=取舍在案：永砖更差）。
  // reset 标志上抛——宿主落账「执行态已重置」注记，不伪造无恢复（E2 契约更新）。
  let frag: unknown
  let ep: EpisodeRef | null = null
  try {
    const parsed = JSON.parse(row.body) as { frag?: unknown; ep?: EpisodeRef }
    // T-O-12 信封行 {frag, ep}；旧裸 frag 行向后兼容（ep 段缺位→下行补 genesis）。
    frag = parsed !== null && typeof parsed === 'object' && parsed.frag !== undefined ? parsed.frag : parsed
    ep = parsed !== null && typeof parsed === 'object' && parsed.ep !== undefined ? parsed.ep : null
    return { snap: ctx.kernel.restoreFromFragment(frag), etag: row.etag, ep }
  } catch (e) {
    console.warn(`[pump] loadSnap ${sessionId} 快照不可恢复（按新会话重建）:`, e instanceof Error ? e.message : e)
    return { snap: null, etag: row.etag, ep: null, reset: true }
  }
}

async function saveSnap(ctx: PumpCtx, sessionId: string, snap: KernelSnapshot, etag: string | null, ep?: EpisodeRef | null): Promise<string | { fenced: true }> {
  const frag = ctx.kernel.buildCheckpointFragment(snap)
  // ep 段存在时写信封行 {frag, ep}（T-O-12 checkpoint↔episode 格）；无 ep 保旧裸 frag 形态。
  const body = ep !== undefined && ep !== null ? { frag, ep } : frag
  const cond = etag !== null ? { ifMatch: etag } : { ifNoneMatch: '*' as const }
  const r = await ctx.io.state.putCas(`${ST}/${ctx.owner}/${sessionId}`, JSON.stringify(body), cond)
  if (r.status === 200 && r.etag !== undefined) return r.etag
  if (r.status === 412) return { fenced: true }
  // 非 CAS 冲突的真实故障（413 超限/500 后端）不得误报「写者冲突」（审查 B4）
  throw new Error(`saveSnap putCas ${r.status}: 非 412 故障不作 fenced 语义`)
}

/** episodes/ 账行写入：append-only（ifNoneMatch 一次写定）。best-effort——账行是
 *  回放/索引面不是 canonical checkpoint；写败如实 silent 台账，不砖会话。 */
async function writeEpisodeRow(ctx: PumpCtx, sessionId: string, row: EpisodeLedgerRow): Promise<void> {
  try {
    const r = await ctx.io.state.putCas(`${EP}/${ctx.owner}/${row.episode_uuid}`, JSON.stringify(row), { ifNoneMatch: '*' })
    if (r.status !== 200 && r.status !== 412) {
      reportSilent(new Error(`episode 账行写 status=${r.status}`), { op: 'episode-ledger', lane: 'background', sessionId })
    }
    // 412 = 同 uuid 行已在（重试幂等）——append-only 语义不覆写。
  } catch (e) {
    reportSilent(e, { op: 'episode-ledger', lane: 'background', sessionId })
  }
}

/** in-flight compaction 临界区（claims/ kind，T-O-12）：单写者标记 + TTL 兜底 +
 *  完成后显式 del（T-O-11）。返回 true=取得标记。 */
async function takeCompactMark(ctx: PumpCtx, sessionId: string): Promise<boolean> {
  const key = `${CL}/${ctx.owner}/compact-${sessionId}`
  const row = await ctx.io.state.get(key)
  if (row !== null) {
    try {
      const c = JSON.parse(row.body) as { holder: string; expires: string }
      if (c.holder !== ctx.holder && Date.parse(c.expires) > Date.now()) return false
    } catch { /* 坏行可覆盖 */ }
  }
  const body = JSON.stringify({ holder: ctx.holder, expires: new Date(Date.now() + 60000).toISOString() })
  const r = await ctx.io.state.putCas(key, body, row !== null ? { ifMatch: row.etag } : { ifNoneMatch: '*' })
  return r.status === 200
}

/** 新 episode 开账：ledger 行 + 返回新 EpisodeRef（seq 延续——session 单调不复位）。 */
async function openEpisode(ctx: PumpCtx, sessionId: string, row: EpisodeLedgerRow, seq: number): Promise<EpisodeRef> {
  await writeEpisodeRow(ctx, sessionId, row)
  return { uuid: row.episode_uuid, seq, events: [], summary_sha: row.summary_sha }
}

/**
 * T-O-12 compaction 正路：claims 临界区 → io.llm summarize → replay/summary artifacts →
 * 新 episode 账行（父产出挂账）。返回 {ep, messages, tokensFreed} 供 kernel compact_done；
 * 标记未取到 → null（调用方按 suspended 收，不 resume 防双开 episode）。
 */
async function runCompaction(
  ctx: PumpCtx,
  sessionId: string,
  turn: { messages?: unknown[] } | null | undefined,
  ep: EpisodeRef | null,
  triggerKind: string | null,
): Promise<{ ep: EpisodeRef; messages: unknown[]; tokensFreed: number } | null> {
  // T-O-23 ②③：不发射 started/failed/degraded/recovered/noop，不调用 decideAsyncArm。
  const marked = await takeCompactMark(ctx, sessionId)
  if (!marked || triggerKind === null) return null
  try {
    const closedEvents = ep !== null ? [...ep.events] : []
    const closedUuid = ep?.uuid
    const headSeq = ep?.seq ?? 0
    const msgs = foldTranscript(turn?.messages ?? [], undefined).messages
    // summarize：kernel 当前 turn messages 序列化后求摘要（截断 60K 防超载）。
    const sum = await readLlm(ctx.io.llm(assemble({
      transcript: [{
        role: 'user',
        content: `Summarize this agent conversation for continuation. Preserve durable facts, tool results and pending decisions; drop chatter. Conversation JSON:\n${JSON.stringify(msgs).slice(0, 60000)}`,
      }],
      steering: null,
    }), { internal: true }))
    const summaryText = sum.text ?? ''
    // 回放 artifact：被关闭 episode 的 step_decision JSONL（dropped 如实计数非静默丢）。
    let replaySha: string | undefined
    if (ctx.io.artifacts !== undefined) {
      const rl = await ctx.io.artifacts.publishJson({
        kind: 'episode-replay', episode_uuid: closedUuid, head_event_seq: headSeq,
        events: closedEvents, dropped: Math.max(0, headSeq - closedEvents.length),
      })
      replaySha = rl?.sha256
    }
    // summary artifact：挂 replay_sha；无 artifacts 车道降级 → summary_text 内嵌账行。
    let summarySha: string | undefined
    let summaryInline: string | undefined
    if (ctx.io.artifacts !== undefined) {
      const sp = await ctx.io.artifacts.publishJson({
        kind: 'episode-summary', episode_uuid: closedUuid, replay_sha: replaySha, summary: summaryText,
      })
      summarySha = sp?.sha256
    } else {
      summaryInline = summaryText
    }
    // 保留集只认 protected fragment。只有一对 usage 才有 tokensFreed，缺一侧不写 0。
    const pair = (usage: { inputTokens?: number; outputTokens?: number } | undefined): number | undefined =>
      typeof usage?.inputTokens === 'number' && typeof usage.outputTokens === 'number'
        ? usage.inputTokens + usage.outputTokens
        : undefined
    const tokensAfter = pair(sum.usage)
    const tokensBefore = pair(lastUsage.get(sessionId))
    if (tokensBefore === undefined || tokensAfter === undefined) return null
    const tail = protectedTail(msgs)
    const compacted: unknown[] = [
      { role: 'system', content: `[compaction summary · episode ${closedUuid ?? 'genesis'}]\n${summaryText}` },
      ...tail,
    ]
    const tokensFreed = tokensBefore - tokensAfter
    if (tokensFreed <= 0) return null
    ep = await openEpisode(ctx, sessionId, {
      episode_uuid: evUuid(),
      trigger: 'auto',
      trigger_kind: triggerKind,
      opened_at: new Date().toISOString(),
      parent_episode_uuid: closedUuid,
      summary_sha: summarySha,
      replay_sha: replaySha,
      summary_text: summaryInline,
      head_event_seq: headSeq,
    }, headSeq)
    console.warn('[compact]', JSON.stringify({ sessionId, tokensBefore, tokensAfter, tokensFreed, triggerKind }))
    return { ep, messages: compacted, tokensFreed }
  } finally {
    try { await ctx.io.state.del(`${CL}/${ctx.owner}/compact-${sessionId}`) } catch { /* 标记靠 TTL 兜底 */ }
  }
}

/** timed-wait alarm 写入面（当前 InterruptReason 闭集无定时等待——保留供扩约后的 timed-wait）。 */
export async function writeAlarm(ctx: PumpCtx, sessionId: string, etag: string | null): Promise<void> {
  const dueAt = Date.now()
  const rec: AlarmRecord = { sessionId, kind: 'turn-resume', dueAt, fence: etag ?? 'new' }
  await ctx.io.state.putCas(`${AL}/${ctx.owner}/${dueAt}-${sessionId}`, JSON.stringify(rec), { ifNoneMatch: '*' })
}

export async function runPump(ctx: PumpCtx, sessionId: string, opts: PumpOptions & { cancelRequested?: () => boolean } = {}): Promise<PumpResult> {
  // 默认 TTL 须 > 单步最坏时长（io.llm timeout=60s）——心跳只在步边界续约，
  // 步中过期会让对手接管并双跑 side-effect step（N4 不变量违例，审查 B8）。
  const claimTtl = opts.claimTtlMs ?? 90000
  const cl = await claim(ctx, sessionId, claimTtl)
  if (cl.status !== 200) return { outcome: 'claim-denied', trace: [], rival: cl.holder }
  // claim 心跳：长 turn（>ttl）不续约会被对手接管 → 每步检查、过期前 30% 续约；
  // 续约 412 = 已丢单写者 → 如实 fenced（审查 B8）。claimTtl<=0 为测试自杀车道不续约。
  let claimDeadline = claimTtl > 0 ? Date.now() + claimTtl : Number.POSITIVE_INFINITY
  const renewClaim = async (): Promise<boolean> => {
    if (claimTtl <= 0 || Date.now() < claimDeadline - claimTtl * 0.3) return true
    const r = await claim(ctx, sessionId, claimTtl)
    if (r.status !== 200) return false
    claimDeadline = Date.now() + claimTtl
    return true
  }

  const loaded = await loadSnap(ctx, sessionId)
  let { snap, etag, ep } = loaded
  // reset 透传所有返回面——宿主（runtime/sweeper）据此落账重置注记（审查十四轮 M5）。
  const ret = (r: PumpResult): PumpResult => loaded.reset === true ? { ...r, reset: true } : r
  // episode genesis：新会话与旧裸 frag 行升级都在此补账（T-O-12；账行 best-effort）。
  // 先于首写建立——首次 saveSnap 即带 ep 段，省一次 CAS。
  if (ep === null) {
    ep = await openEpisode(ctx, sessionId, {
      episode_uuid: evUuid(),
      trigger: 'auto',
      trigger_kind: 'genesis',
      opened_at: new Date().toISOString(),
      head_event_seq: 0,
    }, 0)
  }
  if (snap === null) {
    snap = ctx.kernel.createKernelSnapshot(ctx.kernel.createInitialSessionState())
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}` })
    const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
    if (typeof wr === 'object') return ret({ outcome: 'fenced', trace: [] })
    if (typeof wr === 'string') etag = wr
  }
  const pushEvent = (d: StepDecision): void => {
    if (ep === null) return
    ep.seq += 1
    if (ep.events.length < EP_EVENTS_CAP) {
      ep.events.push({ event_uuid: evUuid(), episode_uuid: ep.uuid, event_seq: ep.seq, kind: 'step_decision', decision: d.kind, reason: d.reason, at: Date.now() })
    }
  }
  // idle 会话新一轮：complete_turn 后 phase=idle/activeTurn=null——须先 start_turn
  // 再经下方正路播种；此前该路径缺失，scheduleNextStep 对 idle 快照照发 llm_call
  // 导致 io.llm([]) 空 messages 400（真机 B-43 第二轮全灭根因）。
  let phase = (snap.session as { phase?: string }).phase
  if (phase === 'idle' || phase === 'ended') {
    if (opts.input === undefined || phase === 'ended') return ret({ outcome: 'completed', trace: [] })
    const turnCount = (snap.session as { turnCount?: number }).turnCount ?? 0
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}-t${turnCount}` })
    const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
    if (typeof wr === 'object') return ret({ outcome: 'fenced', trace: [] })
    if (typeof wr === 'string') etag = wr
    phase = 'turn_running'
  }
  // 输入播种（审查 F1）：input_arrived 只在 waiting 缓冲，经 resume 折叠进 messages——
  // 新 turn 走 interrupt→input_arrived→resume 正路，不得直接塞 activeTurn。
  const needSeed = phase === 'turn_running' && opts.input !== undefined
  if (needSeed || phase === 'waiting') {
    // 'interrupted'（fatal_error 终态）不进 resume——resume 仅接受 waiting
    if (needSeed) snap = ctx.kernel.applyAction(snap, { type: 'interrupt', reason: 'confirmation_pending' })
    if (opts.input !== undefined) {
      snap = ctx.kernel.applyAction(snap, { type: 'input_arrived', input: opts.input })
    }
    snap = ctx.kernel.applyAction(snap, { type: 'resume' })
    const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
    if (typeof wr === 'object') return ret({ outcome: 'fenced', trace: [] })
    if (typeof wr === 'string') etag = wr
  }

  const trace: string[] = []
  for (let i = 0; i < (opts.maxSteps ?? 50); i++) {
    if (!(await renewClaim())) return ret({ outcome: 'fenced', trace })
    const turn = snap.activeTurn as { turnId?: string; epoch?: number; stepIndex?: number; messages?: unknown[]; pendingToolCalls?: unknown[]; llmFinished?: boolean } | null
    const signals: SchedulerSignals = {
      hasMoreToolCalls: (turn?.pendingToolCalls?.length ?? 0) > 0,
      // 宿主 compact 触发策略（非合同）：turn.messages 序列化逼近 256KB 行前压实。
      compactRequired: (await evaluateCompact(
        {
          usage: lastUsage.get(sessionId),
          maxTokens: ctx.io.modelMaxTokens,
          triggerKind: ctx.io.compactPolicy === undefined ? undefined : 'structural',
        },
        ctx.io.compactPolicy,
      )).required,
      cancelRequested: opts.cancelRequested?.() === true,
      timeoutReached: false,
      llmFinished: turn?.llmFinished ?? false,
      expectedTurnId: turn?.turnId,
      expectedTurnEpoch: turn?.epoch,
    }
    const d: StepDecision = ctx.kernel.scheduleNextStep(snap, signals)
    trace.push(d.kind + (d.reason !== undefined ? `:${d.reason}` : ''))
    pushEvent(d)

    if (d.kind === 'llm_call') {
      const out = await readLlm(ctx.io.llm(assemble({ transcript: foldTranscript(turn?.messages ?? [], undefined).messages, steering: null })))
      if (out.usage !== undefined) lastUsage.set(sessionId, out.usage)
      const hasUsage = out.usage !== undefined
        && (typeof out.usage.inputTokens === 'number' || typeof out.usage.outputTokens === 'number')
      const hasTools = out.toolCalls !== undefined && out.toolCalls.length > 0
      if (hasUsage || !hasTools) {
        const action: Record<string, unknown> = {
          type: 'llm_response',
          content: hasTools ? null : (typeof out.text === 'string' ? { role: 'assistant', content: out.text } : null),
        }
        if (hasUsage) action.usage = out.usage
        snap = ctx.kernel.applyAction(snap, action)
      }
      if (hasTools) {
        snap = ctx.kernel.applyAction(snap, { type: 'tool_calls_requested', calls: out.toolCalls, textContent: out.text ?? null })
      }
    } else if (d.kind === 'tool_exec') {
      const res = await ctx.io.tool(d.toolName ?? '', d.args)
      snap = ctx.kernel.applyAction(snap, { type: 'tool_result', callId: d.requestId, result: res })
    } else if (d.kind === 'wait') {
      snap = ctx.kernel.applyAction(snap, { type: 'interrupt', reason: d.reason })
      if (d.reason === 'cancel' || d.reason === 'timeout') {
        // 终态中断：resume→complete_turn 干净收尾，不落 alarm（无东西可续）
        snap = ctx.kernel.applyAction(snap, { type: 'resume' })
        snap = ctx.kernel.applyAction(snap, { type: 'complete_turn', reason: d.reason })
        const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
        // fenced 时 claim 行可能已被对手改写——del 会释放他人持锁（审查十四轮 L4）。
        if (typeof wr !== 'object') await ctx.io.state.del(`${CL}/${ctx.owner}/${sessionId}`)
        return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'completed', trace })
      }
      if (d.reason === 'compact_required') {
        // interrupt-taxonomy 死路径守卫（本 kernel build 不从此发 compact）——走同一正路。
        const armed = await evaluateCompact(
          {
            usage: lastUsage.get(sessionId),
            maxTokens: ctx.io.modelMaxTokens,
            triggerKind: ctx.io.compactPolicy === undefined ? undefined : 'structural',
          },
          ctx.io.compactPolicy,
        )
        const c = await runCompaction(ctx, sessionId, turn, ep, armed.triggerKind ?? null)
        if (c === null) {
          const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
          return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'suspended', trace })
        }
        ep = c.ep
        snap = ctx.kernel.applyAction(snap, { type: 'compact_done', tokensFreed: c.tokensFreed, messages: c.messages })
        // 压缩后用旧 usage 再判会无限重压；清掉等下一次 llm 调用重新计量。
        lastUsage.delete(sessionId)
        snap = ctx.kernel.applyAction(snap, { type: 'resume' })
        const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
        if (typeof wr === 'object') return ret({ outcome: 'fenced', trace })
        etag = wr
        // 真 compaction 后 kernel 仍连续要 compact = 摘要未生效——止损防死循环（如实终止非静默）。
        if (trace.length >= 2 && trace[trace.length - 2].startsWith('wait:compact_required')) {
          return ret({ outcome: 'step-exhausted', trace })
        }
        continue
      }
      // confirmation_pending/fatal_error：挂起等外部输入——不落 due-now alarm
      // （自动复活语义错误）；恢复走 runPump 的 waiting→resume 正路
      const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
      return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'suspended', trace })
    } else if (d.kind === 'finish') {
      snap = ctx.kernel.applyAction(snap, { type: 'complete_turn', reason: d.reason })
      const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
      if (typeof wr !== 'object') await ctx.io.state.del(`${CL}/${ctx.owner}/${sessionId}`)
      return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'completed', trace })
    }
    if (d.kind === 'compact') {
      // T-O-12 正路：kernel 发 compact 决策（signals.compactRequired）→ 宿主压实 →
      // compact_done 置换 messages → 新 episode checkpoint → 循环继续。
      const armed = await evaluateCompact(
        {
          usage: lastUsage.get(sessionId),
          maxTokens: ctx.io.modelMaxTokens,
          triggerKind: ctx.io.compactPolicy === undefined ? undefined : 'structural',
        },
        ctx.io.compactPolicy,
      )
      const c = await runCompaction(ctx, sessionId, turn, ep, armed.triggerKind ?? null)
      if (c === null) {
        // 对手 compaction in-flight——不落盘动作、不推进步；如实 suspended 等下轮。
        const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
        return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'suspended', trace })
      }
      ep = c.ep
      snap = ctx.kernel.applyAction(snap, { type: 'compact_done', tokensFreed: c.tokensFreed, messages: c.messages })
      lastUsage.delete(sessionId)
      const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
      if (typeof wr === 'object') return ret({ outcome: 'fenced', trace })
      etag = wr
      if (opts.killAfter !== undefined && i === opts.killAfter - 1) return ret({ outcome: 'killed', trace })
      continue
    }
    // hook_emit：kernel 内部语义，本宿主按 step 推进（事件外发属后续 AP）
    snap = ctx.kernel.applyAction(snap, { type: 'complete_step', stepIndex: turn?.stepIndex ?? 0, result: null })
    const wr = await saveSnap(ctx, sessionId, snap, etag, ep)
    if (typeof wr === 'object') return ret({ outcome: 'fenced', trace })
    etag = wr
    if (opts.killAfter !== undefined && i === opts.killAfter - 1) return ret({ outcome: 'killed', trace })
  }
  return ret({ outcome: 'step-exhausted', trace })
}

/** 非终态重臂（审查三轮 N8）：claim-denied/fenced/step-exhausted/killed/异常不是
 *  简单留行——同 dueAt 每个 tick 都满 maxSteps 重跑=无界烧 llm（确定性故障如
 *  >256KB 413 每 tick 烧真 llm 调用，审查四轮 F2）。原键内嵌 dueTs 不可原地改，
 *  故先写新 dueTs 键（写败保旧行不丢 resume 触发）再删旧键；attempts 记账、封顶放弃。 */
async function rearmOrDrop(ctx: PumpCtx, key: string, rec: AlarmRecord, reason: string): Promise<void> {
  // 腐行防御：attempts 非数值（外部写坏）时 '+1' 产 NaN/字符串永不 >=5、
  // dueAt=NaN 恒 due——封顶与退避双失效，每 tick 满步重跑正是 N8 要堵的无界烧（审查五轮）。
  const attempts = (Number.isFinite(rec.attempts) ? (rec.attempts as number) : 0) + 1
  if (attempts >= 5) {
    console.warn(`[pump] sweepTick ${rec.sessionId} 重臂 ${attempts} 次仍 ${reason}——alarm 消费放弃（如实止损）`)
    // 恢复意图真放弃=用户可见事件（MN03-R1）——toast 非静默台账。
    errorBus.report(
      { code: 'alarm-abandoned', message: `后台恢复 ${rec.sessionId} 重试 ${attempts} 次仍 ${reason}——已放弃`, retryable: false },
      { op: 'alarm-rearm', lane: 'background', sessionId: rec.sessionId },
    )
    await ctx.io.state.del(key)
    return
  }
  const nextDue = Date.now() + 30000 * Math.pow(2, attempts - 1)
  const wr = await ctx.io.state.putCas(`${AL}/${ctx.owner}/${nextDue}-${rec.sessionId}`, JSON.stringify({ ...rec, dueAt: nextDue, attempts }), { ifNoneMatch: '*' })
  if (wr.status === 200) {
    await ctx.io.state.del(key)
    return
  }
  // 412=并发重臂已写同键——resume 意图由在案行承载，消费旧行防双跑；
  // 其他非 200（不抛的 5xx）新行未落地——旧行保留下 tick 重试不丢触发。
  if (wr.status === 412) {
    try { await ctx.io.state.del(key) } catch { /* 留行下 tick 重试 */ }
    return
  }
  console.warn(`[pump] sweepTick ${rec.sessionId} 重臂写新行 status=${wr.status}——旧行保留`)
  reportSilent(new Error(`alarm 重臂写新行 status=${wr.status}`), { op: 'alarm-rearm', lane: 'background', sessionId: rec.sessionId, status: wr.status })
}

/** sweeper 单次 tick：枚举 owner 前缀下 due 的 alarm → claim 行 → runPump 恢复。 */
export async function sweepTick(
  ctx: PumpCtx,
  opts: { batchLimit?: number } = {},
  makeIo?: (sessionId: string) => Io,
): Promise<SweepResult[]> {
  const due = await ctx.io.state.listPrefix(`${AL}/${ctx.owner}/`)
  const ran: SweepResult[] = []
  // 同 sid 重复 due 行（重臂部分失败的残留）批内只跑一次——否则副本占满
  // batchLimit 饿死其他会话的 alarm（审查五轮）。副本留行下 tick 收敛。
  const seen = new Set<string>()
  // 先滤后切：未来行不占批额——slice 前置会让未来行饿死到期行一个周期（审查十四轮 L13）。
  const limit = opts.batchLimit ?? 10
  let taken = 0
  for (const key of due) {
    if (taken >= limit) break
    const row = await ctx.io.state.get(key)
    if (row === null) continue
    let rec: AlarmRecord
    try { rec = JSON.parse(row.body) as AlarmRecord } catch (e) {
      // 腐行消费=真异常——silent 台账（MN03-R2 B-2），del 失败留行下 tick 重试不终止整批。
      reportSilent(e, { op: 'alarm-parse', lane: 'background', key })
      try { await ctx.io.state.del(key) } catch { /* 消费失败留行下 tick 重试——不终止整批 */ }
      continue
    }
    if (rec.dueAt > Date.now()) continue
    if (seen.has(rec.sessionId)) continue
    seen.add(rec.sessionId)
    taken += 1
    const io = makeIo !== undefined ? makeIo(rec.sessionId) : ctx.io
    // outcome 在 try 内只算不写——后处理统一在 try 外：rearmOrDrop 自身失败不得再
    // 进异常重臂（会产双重臂行），completed 的 del 失败也不得误重臂已完成会话。
    let outcome: string
    try {
      // 先跑后删（at-least-once）：runPump 异常时 alarm 行仍在，下 tick 重试；
      // 重入重复 fire 由 session claim 挡（工具不会双跑——N4 幂等面）。
      const r = await runPump({ ...ctx, io }, rec.sessionId)
      outcome = r.outcome
    } catch (e) {
      // 毒化行不终止整批：异常同走重臂账（审查四轮 F2）——否则确定性故障
      // （腐行/>256KB 413）永留在行，每 tick 满步重跑含真 llm 调用=无界烧。
      console.warn(`[pump] sweepTick ${rec.sessionId} pump error: ${(e as Error).message ?? e}`)
      outcome = 'pump-error'
    }
    ran.push({ sessionId: rec.sessionId, outcome: outcome === 'pump-error' ? 'step-exhausted' : outcome as SweepResult['outcome'] })
    if (outcome === 'completed' || outcome === 'suspended') {
      // 终态消费 alarm：resume 职责已尽；del 失败留行下 tick 收尾。
      try { await ctx.io.state.del(key) } catch { /* 留行下 tick 重试 */ }
    } else {
      try { await rearmOrDrop(ctx, key, rec, outcome) } catch { /* 留行下 tick 重试 */ }
    }
  }
  return ran
}
