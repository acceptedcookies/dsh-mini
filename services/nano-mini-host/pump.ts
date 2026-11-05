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
import { errorBus } from '../error-report'

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

async function loadSnap(ctx: PumpCtx, sessionId: string): Promise<{ snap: KernelSnapshot | null; etag: string | null; reset?: boolean }> {
  const row = await ctx.io.state.get(`${ST}/${ctx.owner}/${sessionId}`)
  if (row === null) return { snap: null, etag: null }
  // 腐行/版本错位（KERNEL_VERSION 升级、JSON 截断、zod 失格）不得永砖会话——
  // 原样传播会让每次 prompt 同点抛出且无复位路径（审查十四轮 M5）。
  // 如实 warn 后按空快照重建：kernel 状态丢但 UI 转录在 s.items 保留；
  // saveSnap 持既有 etag 覆写同键（旧行不复存=取舍在案：永砖更差）。
  // reset 标志上抛——宿主落账「执行态已重置」注记，不伪造无恢复（E2 契约更新）。
  let frag: unknown
  try {
    frag = JSON.parse(row.body)
    return { snap: ctx.kernel.restoreFromFragment(frag), etag: row.etag }
  } catch (e) {
    console.warn(`[pump] loadSnap ${sessionId} 快照不可恢复（按新会话重建）:`, e instanceof Error ? e.message : e)
    return { snap: null, etag: row.etag, reset: true }
  }
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
  let { snap, etag } = loaded
  // reset 透传所有返回面——宿主（runtime/sweeper）据此落账重置注记（审查十四轮 M5）。
  const ret = (r: PumpResult): PumpResult => loaded.reset === true ? { ...r, reset: true } : r
  if (snap === null) {
    snap = ctx.kernel.createKernelSnapshot(ctx.kernel.createInitialSessionState())
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}` })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (typeof wr === 'object') return ret({ outcome: 'fenced', trace: [] })
    if (typeof wr === 'string') etag = wr
  }
  // idle 会话新一轮：complete_turn 后 phase=idle/activeTurn=null——须先 start_turn
  // 再经下方正路播种；此前该路径缺失，scheduleNextStep 对 idle 快照照发 llm_call
  // 导致 io.llm([]) 空 messages 400（真机 B-43 第二轮全灭根因）。
  let phase = (snap.session as { phase?: string }).phase
  if (phase === 'idle' || phase === 'ended') {
    if (opts.input === undefined || phase === 'ended') return ret({ outcome: 'completed', trace: [] })
    const turnCount = (snap.session as { turnCount?: number }).turnCount ?? 0
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}-t${turnCount}` })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
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
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (typeof wr === 'object') return ret({ outcome: 'fenced', trace: [] })
    if (typeof wr === 'string') etag = wr
  }

  const trace: string[] = []
  for (let i = 0; i < (opts.maxSteps ?? 50); i++) {
    if (!(await renewClaim())) return ret({ outcome: 'fenced', trace })
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
        // fenced 时 claim 行可能已被对手改写——del 会释放他人持锁（审查十四轮 L4）。
        if (typeof wr !== 'object') await ctx.io.state.del(`${CL}/${ctx.owner}/${sessionId}`)
        return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'completed', trace })
      }
      if (d.reason === 'compact_required') {
        // 宿主侧无 compaction 实现（T-O 未承诺）——resume 续跑；同决策重复即 bail 防死循环
        snap = ctx.kernel.applyAction(snap, { type: 'resume' })
        const wr = await saveSnap(ctx, sessionId, snap, etag)
        if (typeof wr === 'object') return ret({ outcome: 'fenced', trace })
        etag = wr
        if (trace.length >= 2 && trace[trace.length - 2].startsWith('wait:compact_required')) {
          return ret({ outcome: 'step-exhausted', trace })
        }
        continue
      }
      // confirmation_pending/fatal_error：挂起等外部输入——不落 due-now alarm
      // （自动复活语义错误）；恢复走 runPump 的 waiting→resume 正路
      const wr = await saveSnap(ctx, sessionId, snap, etag)
      return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'suspended', trace })
    } else if (d.kind === 'finish') {
      snap = ctx.kernel.applyAction(snap, { type: 'complete_turn', reason: d.reason })
      const wr = await saveSnap(ctx, sessionId, snap, etag)
      if (typeof wr !== 'object') await ctx.io.state.del(`${CL}/${ctx.owner}/${sessionId}`)
      return ret(typeof wr === 'object' ? { outcome: 'fenced', trace } : { outcome: 'completed', trace })
    }
    // hook_emit / compact：kernel 内部语义，本宿主按 step 推进（事件外发属后续 AP）
    snap = ctx.kernel.applyAction(snap, { type: 'complete_step', stepIndex: turn?.stepIndex ?? 0, result: null })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
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
    try { rec = JSON.parse(row.body) as AlarmRecord } catch {
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
