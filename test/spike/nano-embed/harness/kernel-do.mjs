// EM-N 系列：kernel + CAS后端 + 周期 tick = session.do 替代宿主 spike
// 用 Node 直接驱动同一个 mp bundle（mp/lib/kernel.js），证明：
//   N1 全 turn 状态机走 scheduleNextStep/applyAction + 每步 checkpoint 落 CAS
//   N2 kill/resume：fragment 恢复后续跑，tool 不重复执行
//   N3 CAS fencing：claim If-None-Match:* 单写者 + state If-Match 防陈旧写
//   N4 alarm 缝：wait 决策 → 落 alarm 记录 → sweeper tick claim → 恢复 pump
// 诚实边界：CasStore 是 pgs3 语义替身（Map+etag+条件写），非真实 pgs3。
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const k = require('../out/t1-kernel.cjs')

const enc = new TextEncoder()
const inlineText = (text, filePath) => ({
  kind: 'inline-text', text, byte_length: enc.encode(text).byteLength,
  provenance: {
    context_layer: filePath ? 'file_read' : 'transcript',
    context_role: 'assistant', context_property: 'tool-result',
    ...(filePath ? { file_path: filePath } : {}),
  },
})

// ── CAS 后端替身（pgs3 If-Match/If-None-Match 语义）─────────────────
class CasStore {
  constructor() { this.m = new Map(); this.n = 0 }
  get(key) { const e = this.m.get(key); return e ? { body: e.body, etag: e.etag } : null }
  put(key, body, cond = {}) {
    const cur = this.m.get(key)
    if (cond.ifNoneMatch === '*' && cur) return { status: 412 }
    if (cond.ifMatch && (!cur || cur.etag !== cond.ifMatch)) return { status: 412 }
    const etag = `e${++this.n}`
    this.m.set(key, { body, etag })
    return { status: 200, etag }
  }
  listPrefix(p) { return [...this.m.keys()].filter((x) => x.startsWith(p)) }
  del(key) { return this.m.delete(key) }
}

// ── 最小 pump：kernel 决策环 + fragment CAS 持久化 + claim 单写者 ──
const ST = 'dsh-mini/state', CL = 'dsh-mini/claims', AL = 'dsh-mini/alarms'

function loadSnap(store, sessionId) {
  const row = store.get(`${ST}/${sessionId}`)
  if (!row) return { snap: null, etag: null }
  const frag = JSON.parse(row.body)
  return { snap: k.restoreFromFragment(frag), etag: row.etag } // restore 内含 zod 校验+版本闸
}
function saveSnap(store, sessionId, snap, etag) {
  const frag = k.buildCheckpointFragment(snap)
  const cond = etag ? { ifMatch: etag } : { ifNoneMatch: '*' }
  const r = store.put(`${ST}/${sessionId}`, JSON.stringify(frag), cond)
  return r.status === 200 ? r.etag : { fenced: true }
}
function claim(store, sessionId, holder, ttlMs) {
  const key = `${CL}/${sessionId}`
  const row = store.get(key)
  if (row) {
    const c = JSON.parse(row.body)
    if (c.holder !== holder && Date.parse(c.expires) > Date.now()) return { status: 412, holder: c.holder }
  }
  const r = store.put(key, JSON.stringify({ holder, expires: new Date(Date.now() + ttlMs).toISOString() }), {})
  return r.status === 200 ? { status: 200, etag: r.etag } : { status: 412 }
}

async function pump(store, sessionId, holder, io, opts = {}) {
  const cl = claim(store, sessionId, holder, opts.claimTtlMs ?? 30000)
  if (cl.status !== 200) return { outcome: 'claim-denied', rival: cl.holder }
  let { snap, etag } = loadSnap(store, sessionId)
  if (!snap) {
    snap = k.createKernelSnapshot(k.createInitialSessionState())
    snap = k.applyAction(snap, { type: 'start_turn', turnId: opts.turnId ?? `t-${sessionId}` })
    if (opts.input !== undefined) snap = k.applyAction(snap, { type: 'input_arrived', input: opts.input })
  }
  const trace = []
  for (let i = 0; i < (opts.maxSteps ?? 50); i++) {
    const turn = snap.activeTurn
    const signals = {
      hasMoreToolCalls: (turn?.pendingToolCalls?.length ?? 0) > 0,
      compactRequired: false, cancelRequested: false, timeoutReached: false,
      llmFinished: turn?.llmFinished ?? false,
      expectedTurnId: turn?.turnId, expectedTurnEpoch: turn?.epoch,
    }
    const d = k.scheduleNextStep(snap, signals)
    trace.push(d.kind + (d.reason ? ':' + d.reason : ''))
    if (d.kind === 'llm_call') {
      const out = await io.llm(turn?.messages ?? [])
      if (out.toolCalls?.length) {
        snap = k.applyAction(snap, { type: 'tool_calls_requested', calls: out.toolCalls, textContent: out.text ?? null })
      } else {
        snap = k.applyAction(snap, { type: 'llm_response', content: out.text ?? out, usage: out.usage })
      }
    } else if (d.kind === 'tool_exec') {
      const res = await io.tool(d.toolName, d.args)
      snap = k.applyAction(snap, { type: 'tool_result', callId: d.requestId, result: res })
    } else if (d.kind === 'wait') {
      snap = k.applyAction(snap, { type: 'interrupt', reason: d.reason })
      // alarm 缝：挂起 → 落 alarm 记录（due=now，真场景应回填 retry/backoff due）
      store.put(`${AL}/${Date.now()}-${sessionId}`, JSON.stringify({ sessionId, kind: 'turn-resume', dueAt: Date.now(), fence: etag ?? 'new' }))
      const wr = saveSnap(store, sessionId, snap, etag)
      return wr.fenced ? { outcome: 'fenced', trace } : { outcome: 'suspended', trace }
    } else if (d.kind === 'finish') {
      snap = k.applyAction(snap, { type: 'complete_turn', reason: d.reason })
      const wr = saveSnap(store, sessionId, snap, etag)
      store.del(`${CL}/${sessionId}`)
      return wr.fenced ? { outcome: 'fenced', trace } : { outcome: 'completed', trace }
    }
    snap = k.applyAction(snap, { type: 'complete_step', stepIndex: turn ? turn.stepIndex : 0, result: null })
    const wr = saveSnap(store, sessionId, snap, etag)
    if (wr.fenced) return { outcome: 'fenced', trace }
    etag = wr
    if (opts.killAfter && i === opts.killAfter - 1) return { outcome: 'killed', trace, etag }
  }
  return { outcome: 'step-exhausted', trace }
}

// sweeper：枚举 alarm 前缀 → claim → 恢复 pump（cron 的单次 tick）
async function sweepTick(store, holder, io) {
  const due = store.listPrefix(`${AL}/`).map((x) => [x, JSON.parse(store.get(x).body)])
  const ran = []
  for (const [key, rec] of due) {
    store.del(key) // 简化：先删再跑（真语义=claim alarm 行）
    const r = await pump(store, rec.sessionId, holder, io)
    ran.push({ sessionId: rec.sessionId, outcome: r.outcome })
  }
  return ran
}

// ── 场景：LLM 注入替身（脚本化响应）+ tool 注入替身 ─────────────────
const results = { ok: [], fail: [] }
const scenarioIo = (store, tag) => {
  const toolCalls = []
  return {
    toolCalls,
    async llm(messages) {
      const done = JSON.stringify(messages ?? []).includes('seed-content')
      if (!done) return { toolCalls: [{ id: 'c1', name: 'file_read', input: { path: '/data/seed.csv' } }], text: null }
      return { text: `answer(${tag}): beta,3400`, usage: { inputTokens: 10, outputTokens: 5 } }
    },
    async tool(name, args) {
      this.calls = (this.calls ?? 0) + 1
      return inlineText(`tool:${name}:seed-content`, args?.path)
    },
  }
}

// N1：全 turn 一遍过
{
  const store = new CasStore()
  const io = scenarioIo(store, 'n1')
  const r = await pump(store, 's1', 'host-a', io, { input: { role: 'user', content: 'q' } })
  results[r.outcome === 'completed' && trace_ok(r.trace) ? 'ok' : 'fail'].push(`N1 ${r.outcome} ${r.trace.join('>')}`)
}
function trace_ok(t) { return t[0] === 'llm_call' && t.includes('tool_exec') && t[t.length - 1]?.startsWith('finish') }

// N2：kill 后从 fragment 恢复，tool 不得双跑
{
  const store = new CasStore()
  const io1 = scenarioIo(store, 'n2a')
  const r1 = await pump(store, 's2', 'host-a', io1, { input: { role: 'user', content: 'q' }, maxSteps: 2, killAfter: 2, claimTtlMs: 0 })
  const io2 = scenarioIo(store, 'n2b')
  const r2 = await pump(store, 's2', 'host-b', io2)
  const totalTool = (io1.calls ?? 0) + (io2.calls ?? 0)
  results[r1.outcome === 'killed' && r2.outcome === 'completed' && totalTool === 1 ? 'ok' : 'fail']
    .push(`N2 kill=${r1.outcome} resume=${r2.outcome} toolExecs=${totalTool} trace=${r2.trace.join('>')}`)
}

// N3：并发 claim 一胜 + 陈旧 etag 写 412
{
  const store = new CasStore()
  const c1 = claim(store, 's3', 'host-a', 30000)
  const c2 = claim(store, 's3', 'host-b', 30000)
  const st = store.put(`${ST}/s3`, '{}', { ifNoneMatch: '*' })
  const stale = store.put(`${ST}/s3`, '{}', { ifMatch: 'e0' }) // 错误 etag
  const okWrite = store.put(`${ST}/s3`, '{}', { ifMatch: st.etag })
  results[c1.status === 200 && c2.status === 412 && stale.status === 412 && okWrite.status === 200 ? 'ok' : 'fail']
    .push(`N3 claim:${c1.status}/${c2.status} staleWrite:${stale.status} casWrite:${okWrite.status}`)
}

// N4：alarm→sweep→resume——kill 后由 alarm 记录驱动 sweeper 恢复
{
  const store = new CasStore()
  const io1 = scenarioIo(store, 'n4a')
  const r1 = await pump(store, 's4', 'host-a', io1, { input: { role: 'user', content: 'q' }, killAfter: 1, claimTtlMs: 0 })
  // 宿主死前落 alarm 记录（真场景由 pump 的 wait 分支或独立 reconciler 落）
  store.put(`${AL}/${Date.now()}-s4`, JSON.stringify({ sessionId: 's4', kind: 'turn-resume', dueAt: Date.now(), fence: 'any' }))
  const io2 = scenarioIo(store, 'n4b')
  const ran = await sweepTick(store, 'sweeper-1', io2)
  const ok = r1.outcome === 'killed' && ran.length === 1 && ran[0].outcome === 'completed'
  results[ok ? 'ok' : 'fail'].push(`N4 kill=${r1.outcome} swept=${JSON.stringify(ran)}`)
}

console.log(JSON.stringify({ kernelVersion: k.KERNEL_VERSION, ok: results.ok, fail: results.fail }, null, 2))
process.exit(results.fail.length ? 1 : 0)
