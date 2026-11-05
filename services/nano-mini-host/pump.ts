/**
 * pump —— kernel 决策环 + fragment CAS 持久化 + claim 单写者 + alarm 缝。
 * kernel-do.mjs:64-125 spike 产品化（EM-N1~N4 已证）。
 * kernel 模块注入（mp 经 subpkg/kernel/kernel.js、sweeper 经 vendor/kernel.cjs），
 * Io{llm,tool,state} 注入（T-O-3：mp 与 sweeper 共享同一份 pump）。
 */

import type {
  AlarmRecord,
  Io,
  KernelModule,
  KernelSnapshot,
  PumpOptions,
  PumpResult,
  SchedulerSignals,
  StepDecision,
  SweepResult,
} from './types'

const ST = 'dsh-mini/state'
const CL = 'dsh-mini/claims'
const AL = 'dsh-mini/alarms'

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

async function loadSnap(ctx: PumpCtx, sessionId: string): Promise<{ snap: KernelSnapshot | null; etag: string | null }> {
  const row = await ctx.io.state.get(`${ST}/${ctx.owner}/${sessionId}`)
  if (row === null) return { snap: null, etag: null }
  const frag = JSON.parse(row.body)
  // restoreFromFragment 内含 zod schema 校验 + KERNEL_VERSION 版本闸
  return { snap: ctx.kernel.restoreFromFragment(frag), etag: row.etag }
}

async function saveSnap(ctx: PumpCtx, sessionId: string, snap: KernelSnapshot, etag: string | null): Promise<string | { fenced: true }> {
  const frag = ctx.kernel.buildCheckpointFragment(snap)
  const cond = etag !== null ? { ifMatch: etag } : { ifNoneMatch: '*' as const }
  const r = await ctx.io.state.putCas(`${ST}/${ctx.owner}/${sessionId}`, JSON.stringify(frag), cond)
  if (r.status === 200 && r.etag !== undefined) return r.etag
  if (r.status === 412) return { fenced: true }
  // 非 CAS 冲突的真实故障（413 超限/500 后端）不得误报「写者冲突」（审查 B4）
  throw new Error(`saveSnap putCas ${r.status}: 非 412 故障不作 fenced 语义`)
}

/** timed-wait alarm 写入面（当前 InterruptReason 闭集无定时等待——保留供扩约后的 timed-wait）。 */
export async function writeAlarm(ctx: PumpCtx, sessionId: string, etag: string | null): Promise<void> {
  const dueAt = Date.now()
  const rec: AlarmRecord = { sessionId, kind: 'turn-resume', dueAt, fence: etag ?? 'new' }
  await ctx.io.state.putCas(`${AL}/${ctx.owner}/${dueAt}-${sessionId}`, JSON.stringify(rec), { ifNoneMatch: '*' })
}

export async function runPump(ctx: PumpCtx, sessionId: string, opts: PumpOptions & { cancelRequested?: () => boolean } = {}): Promise<PumpResult> {
  const claimTtl = opts.claimTtlMs ?? 30000
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

  let { snap, etag } = await loadSnap(ctx, sessionId)
  if (snap === null) {
    snap = ctx.kernel.createKernelSnapshot(ctx.kernel.createInitialSessionState())
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}` })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (typeof wr === 'object') return { outcome: 'fenced', trace: [] }
    if (typeof wr === 'string') etag = wr
  }
  // idle 会话新一轮：complete_turn 后 phase=idle/activeTurn=null——须先 start_turn
  // 再经下方正路播种；此前该路径缺失，scheduleNextStep 对 idle 快照照发 llm_call
  // 导致 io.llm([]) 空 messages 400（真机 B-43 第二轮全灭根因）。
  let phase = (snap.session as { phase?: string }).phase
  if (phase === 'idle' || phase === 'ended') {
    if (opts.input === undefined || phase === 'ended') return { outcome: 'completed', trace: [] }
    const turnCount = (snap.session as { turnCount?: number }).turnCount ?? 0
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}-t${turnCount}` })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (typeof wr === 'object') return { outcome: 'fenced', trace: [] }
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
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (typeof wr === 'object') return { outcome: 'fenced', trace: [] }
    if (typeof wr === 'string') etag = wr
  }

  const trace: string[] = []
  for (let i = 0; i < (opts.maxSteps ?? 50); i++) {
    if (!(await renewClaim())) return { outcome: 'fenced', trace }
    const turn = snap.activeTurn as { turnId?: string; epoch?: number; stepIndex?: number; messages?: unknown[]; pendingToolCalls?: unknown[]; llmFinished?: boolean } | null
    const signals: SchedulerSignals = {
      hasMoreToolCalls: (turn?.pendingToolCalls?.length ?? 0) > 0,
      compactRequired: false,
      cancelRequested: opts.cancelRequested?.() === true,
      timeoutReached: false,
      llmFinished: turn?.llmFinished ?? false,
      expectedTurnId: turn?.turnId,
      expectedTurnEpoch: turn?.epoch,
    }
    const d: StepDecision = ctx.kernel.scheduleNextStep(snap, signals)
    trace.push(d.kind + (d.reason !== undefined ? `:${d.reason}` : ''))

    if (d.kind === 'llm_call') {
      const out = await ctx.io.llm(turn?.messages ?? [])
      if (out.toolCalls !== undefined && out.toolCalls.length > 0) {
        snap = ctx.kernel.applyAction(snap, { type: 'tool_calls_requested', calls: out.toolCalls, textContent: out.text ?? null })
      } else {
        // llm_response.content 直接被 reducer 压入 messages——必须是消息对象非裸串（审查 F5）
        snap = ctx.kernel.applyAction(snap, {
          type: 'llm_response',
          content: typeof out.text === 'string' ? { role: 'assistant', content: out.text } : null,
          usage: out.usage,
        })
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
        const wr = await saveSnap(ctx, sessionId, snap, etag)
        await ctx.io.state.del(`${CL}/${ctx.owner}/${sessionId}`)
        return typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'completed', trace }
      }
      if (d.reason === 'compact_required') {
        // 宿主侧无 compaction 实现（T-O 未承诺）——resume 续跑；同决策重复即 bail 防死循环
        snap = ctx.kernel.applyAction(snap, { type: 'resume' })
        const wr = await saveSnap(ctx, sessionId, snap, etag)
        if (typeof wr === 'object') return { outcome: 'fenced', trace }
        etag = wr
        if (trace.length >= 2 && trace[trace.length - 2].startsWith('wait:compact_required')) {
          return { outcome: 'step-exhausted', trace }
        }
        continue
      }
      // confirmation_pending/fatal_error：挂起等外部输入——不落 due-now alarm
      // （自动复活语义错误）；恢复走 runPump 的 waiting→resume 正路
      const wr = await saveSnap(ctx, sessionId, snap, etag)
      return typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'suspended', trace }
    } else if (d.kind === 'finish') {
      snap = ctx.kernel.applyAction(snap, { type: 'complete_turn', reason: d.reason })
      const wr = await saveSnap(ctx, sessionId, snap, etag)
      await ctx.io.state.del(`${CL}/${ctx.owner}/${sessionId}`)
      return typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'completed', trace }
    }
    // hook_emit / compact：kernel 内部语义，本宿主按 step 推进（事件外发属后续 AP）
    snap = ctx.kernel.applyAction(snap, { type: 'complete_step', stepIndex: turn?.stepIndex ?? 0, result: null })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (typeof wr === 'object') return { outcome: 'fenced', trace }
    etag = wr
    if (opts.killAfter !== undefined && i === opts.killAfter - 1) return { outcome: 'killed', trace }
  }
  return { outcome: 'step-exhausted', trace }
}

/** sweeper 单次 tick：枚举 owner 前缀下 due 的 alarm → claim 行 → runPump 恢复。 */
export async function sweepTick(
  ctx: PumpCtx,
  opts: { batchLimit?: number } = {},
  makeIo?: (sessionId: string) => Io,
): Promise<SweepResult[]> {
  const due = await ctx.io.state.listPrefix(`${AL}/${ctx.owner}/`)
  const ran: SweepResult[] = []
  for (const key of due.slice(0, opts.batchLimit ?? 10)) {
    const row = await ctx.io.state.get(key)
    if (row === null) continue
    let rec: AlarmRecord
    try { rec = JSON.parse(row.body) as AlarmRecord } catch {
      try { await ctx.io.state.del(key) } catch { /* 消费失败留行下 tick 重试——不终止整批 */ }
      continue
    }
    if (rec.dueAt > Date.now()) continue
    const io = makeIo !== undefined ? makeIo(rec.sessionId) : ctx.io
    try {
      // 先跑后删（at-least-once）：runPump 异常时 alarm 行仍在，下 tick 重试；
      // 重入重复 fire 由 session claim 挡（工具不会双跑——N4 幂等面）。
      const r = await runPump({ ...ctx, io }, rec.sessionId)
      await ctx.io.state.del(key)
      ran.push({ sessionId: rec.sessionId, outcome: r.outcome })
    } catch (e) {
      // 毒化行不终止整批：留 alarm 等下 tick（天然退避=周期）；
      // outcome 沿用 step-exhausted 枚举（不扩约），真实原因日志登记——不谎报。
      console.warn(`[pump] sweepTick ${rec.sessionId} pump error: ${(e as Error).message ?? e}`)
      ran.push({ sessionId: rec.sessionId, outcome: 'step-exhausted' })
    }
  }
  return ran
}
