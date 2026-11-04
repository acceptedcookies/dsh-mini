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
  return r.status === 200 && r.etag !== undefined ? r.etag : { fenced: true }
}

async function writeAlarm(ctx: PumpCtx, sessionId: string, etag: string | null): Promise<void> {
  const dueAt = Date.now()
  const rec: AlarmRecord = { sessionId, kind: 'turn-resume', dueAt, fence: etag ?? 'new' }
  await ctx.io.state.putCas(`${AL}/${ctx.owner}/${dueAt}-${sessionId}`, JSON.stringify(rec), { ifNoneMatch: '*' })
}

export async function runPump(ctx: PumpCtx, sessionId: string, opts: PumpOptions & { cancelRequested?: () => boolean } = {}): Promise<PumpResult> {
  const cl = await claim(ctx, sessionId, opts.claimTtlMs ?? 30000)
  if (cl.status !== 200) return { outcome: 'claim-denied', trace: [], rival: cl.holder }

  let { snap, etag } = await loadSnap(ctx, sessionId)
  if (snap === null) {
    snap = ctx.kernel.createKernelSnapshot(ctx.kernel.createInitialSessionState())
    snap = ctx.kernel.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}` })
    if (opts.input !== undefined) snap = ctx.kernel.applyAction(snap, { type: 'input_arrived', input: opts.input })
    const wr = await saveSnap(ctx, sessionId, snap, etag)
    if (wr === 'object' && typeof wr === 'object') return { outcome: 'fenced', trace: [] }
    if (typeof wr === 'string') etag = wr
  }

  const trace: string[] = []
  for (let i = 0; i < (opts.maxSteps ?? 50); i++) {
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
        snap = ctx.kernel.applyAction(snap, { type: 'llm_response', content: out.text ?? '', usage: out.usage })
      }
    } else if (d.kind === 'tool_exec') {
      const res = await ctx.io.tool(d.toolName ?? '', d.args)
      snap = ctx.kernel.applyAction(snap, { type: 'tool_result', callId: d.requestId, result: res })
    } else if (d.kind === 'wait') {
      snap = ctx.kernel.applyAction(snap, { type: 'interrupt', reason: d.reason })
      await writeAlarm(ctx, sessionId, etag)
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
    try { rec = JSON.parse(row.body) as AlarmRecord } catch { await ctx.io.state.del(key); continue }
    if (rec.dueAt > Date.now()) continue
    await ctx.io.state.del(key) // claim alarm 行（替身语义：先删再跑；重入由 session claim 挡）
    const io = makeIo !== undefined ? makeIo(rec.sessionId) : ctx.io
    const r = await runPump({ ...ctx, io }, rec.sessionId)
    ran.push({ sessionId: rec.sessionId, outcome: r.outcome })
  }
  return ran
}
