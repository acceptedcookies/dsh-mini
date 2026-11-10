// sim-wx-alarm · M2 本地 sweepTick 全链（真实 host + 真实 kernel + 内存 CAS）。
// 覆盖：idle 完成 / waiting tool 恰一次 / claim-denied rearm / 5 次 abandon / killAfter 后续跑。
// 用法: node test/simulation/sim-wx-alarm/m2-sweeper.mjs
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { openEvidence } from '../lib/evidence.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const kernelMod = require('../../../cloud/functions/sweeper/vendor/kernel.cjs')
const host = require('../../../cloud/functions/sweeper/vendor/host.cjs')
const kernel = kernelMod.kernel ?? kernelMod

const evidence = openEvidence(dir, 'm2')
const check = (name, ok, detail) => evidence.check(name, ok === true, detail)

function newCas() {
  const rows = new Map()
  let seq = 0
  return {
    get(key) { const r = rows.get(key); return r === undefined ? null : { body: r.body, etag: r.etag } },
    putCas(key, body, cond = {}) {
      const cur = rows.get(key)
      if (cond.ifNoneMatch === '*' && cur !== undefined) return { status: 412 }
      if (cond.ifMatch !== undefined && (cur === undefined || cur.etag !== cond.ifMatch)) return { status: 412 }
      const etag = `e${++seq}`
      rows.set(key, { body, etag })
      return { status: 200, etag }
    },
    listPrefix(prefix) { return [...rows.keys()].filter((k) => k.startsWith(prefix)) },
    del(key) { rows.delete(key) },
    raw: rows,
  }
}

function idleFrag() {
  return JSON.stringify(kernel.buildCheckpointFragment(kernel.createKernelSnapshot(kernel.createInitialSessionState())))
}

function toolFrag(turnId) {
  let snap = kernel.createKernelSnapshot(kernel.createInitialSessionState())
  snap = kernel.applyAction(snap, { type: 'start_turn', turnId })
  snap = kernel.applyAction(snap, { type: 'tool_calls_requested', calls: [{ id: `call-${turnId}`, name: 'sim_tool', input: { turnId } }], textContent: null })
  return JSON.stringify(kernel.buildCheckpointFragment(snap))
}

function waitingFrag(turnId) {
  let snap = kernel.createKernelSnapshot(kernel.createInitialSessionState())
  snap = kernel.applyAction(snap, { type: 'start_turn', turnId })
  return JSON.stringify(kernel.buildCheckpointFragment(snap))
}

function putState(cas, sid, frag) {
  const r = cas.putCas(`dsh-mini/state/local/${sid}`, frag, { ifNoneMatch: '*' })
  if (r.status !== 200) throw new Error(`state put ${sid} ${r.status}`)
}

function putAlarm(cas, sid, dueAt) {
  const r = cas.putCas(`dsh-mini/alarms/local/${dueAt}-${sid}`, JSON.stringify({ sessionId: sid, kind: 'turn-resume', dueAt, fence: 'new' }), { ifNoneMatch: '*' })
  if (r.status !== 200) throw new Error(`alarm put ${sid} ${r.status}`)
}

function makeIo(cas, { tool = 'ok', toolThrows = false } = {}) {
  const counts = { llm: 0, tool: 0 }
  const io = {
    state: cas,
    llm: async function* () {
      counts.llm += 1
      yield { kind: 'content', text: 'sim-final' }
      yield { kind: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { kind: 'done' }
    },
    tool: async (name) => {
      if (toolThrows) { counts.tool += 1; throw new Error('sim_tool_fail') }
      counts.tool += 1
      const text = JSON.stringify({ tool: name, n: counts.tool })
      return { kind: 'inline-text', text, byte_length: text.length, provenance: { context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' } }
    },
  }
  return { io, counts }
}

function ctx(io) {
  return { kernel, io, owner: 'local', holder: 'm2-sweeper' }
}

const now = Date.now()

// 1. idle + due → completed，alarm 删除，第二次空
{
  const cas = newCas()
  const sid = `m2-idle-${now}`
  putState(cas, sid, idleFrag())
  putAlarm(cas, sid, now - 1)
  const { io, counts } = makeIo(cas)
  const first = await host.sweepTick(ctx(io), { batchLimit: 10 })
  const alarmGone = cas.get(`dsh-mini/alarms/local/${now - 1}-${sid}`) === null
  const second = await host.sweepTick(ctx(io), { batchLimit: 10 })
  check('m2:idle-completed', first.length === 1 && first[0].outcome === 'completed' && alarmGone && second.length === 0 && counts.llm === 0 && counts.tool === 0, JSON.stringify({ first, alarmGone, second, counts }))
}

// 2. waiting pending tool + due → tool 恰一次 → llm final → completed
{
  const cas = newCas()
  const sid = `m2-tool-${now}`
  putState(cas, sid, toolFrag(`t-${now}`))
  putAlarm(cas, sid, now - 1)
  const { io, counts } = makeIo(cas)
  const first = await host.sweepTick(ctx(io), { batchLimit: 10 })
  const state = cas.get(`dsh-mini/state/local/${sid}`)
  let phase = null
  try { const b = JSON.parse(state.body); phase = (b.frag ?? b).session?.phase } catch { /* ignore */ }
  check('m2:tool-exactly-once', first.length === 1 && first[0].outcome === 'completed' && counts.tool === 1 && counts.llm === 1 && phase === 'idle', JSON.stringify({ first, counts, phase }))
}

// 3. rival claim → claim-denied → rearm 一条 attempts=1 的未来 alarm；不跑 tool/llm
{
  const cas = newCas()
  const sid = `m2-claim-${now}`
  putState(cas, sid, idleFrag())
  putAlarm(cas, sid, now - 1)
  cas.putCas(`dsh-mini/claims/local/${sid}`, JSON.stringify({ holder: 'rival', expires: new Date(Date.now() + 60_000).toISOString() }), { ifNoneMatch: '*' })
  const { io, counts } = makeIo(cas)
  const first = await host.sweepTick(ctx(io), { batchLimit: 10 })
  const keys = cas.listPrefix('dsh-mini/alarms/local/')
  const rec = keys.length === 1 ? JSON.parse(cas.get(keys[0]).body) : null
  check('m2:claim-denied-rearm', first.length === 1 && first[0].outcome === 'claim-denied' && keys.length === 1 && rec?.attempts === 1 && rec?.dueAt > Date.now() && counts.tool === 0 && counts.llm === 0, JSON.stringify({ first, keys, rec, counts }))
}

// 4. 连续 5 次 pump error → attempts 1..5 → abandon，alarm 清空
{
  const cas = newCas()
  const sid = `m2-abandon-${now}`
  putState(cas, sid, toolFrag(`t-abandon-${now}`))
  let dueAt = now - 1
  putAlarm(cas, sid, dueAt)
  const { io } = makeIo(cas, { toolThrows: true })
  const warns = []
  const oldWarn = console.warn
  console.warn = (...args) => { warns.push(args.map(String).join(' ')); oldWarn(...args) }
  try {
    let lastOutcome = null
    for (let i = 0; i < 5; i++) {
      const ran = await host.sweepTick(ctx(io), { batchLimit: 10 })
      lastOutcome = ran[0]?.outcome ?? null
      const keys = cas.listPrefix('dsh-mini/alarms/local/')
      if (keys.length === 0) break
      const key = keys[0]
      const rec = JSON.parse(cas.get(key).body)
      cas.del(key)
      dueAt = Date.now() - 1
      cas.putCas(`dsh-mini/alarms/local/${dueAt}-${sid}`, JSON.stringify({ ...rec, dueAt }), { ifNoneMatch: '*' })
    }
    const left = cas.listPrefix('dsh-mini/alarms/local/')
    const abandoned = warns.some((w) => w.includes('放弃'))
    check('m2:rearm-abandon', lastOutcome === 'step-exhausted' && left.length === 0 && abandoned, JSON.stringify({ lastOutcome, left, abandoned }))
  } finally {
    console.warn = oldWarn
  }
}

// 5. runPump killAfter → tool 已跑一次；第二次 runPump 续跑 final，tool 仍 1
{
  const cas = newCas()
  const sid = `m2-kill-${now}`
  putState(cas, sid, toolFrag(`t-kill-${now}`))
  const { io, counts } = makeIo(cas)
  const first = await host.runPump(ctx(io), sid, { killAfter: 1 })
  const second = await host.runPump(ctx(io), sid)
  const state = cas.get(`dsh-mini/state/local/${sid}`)
  let phase = null
  try { const b = JSON.parse(state.body); phase = (b.frag ?? b).session?.phase } catch { /* ignore */ }
  check('m2:kill-after-resume', first.outcome === 'killed' && second.outcome === 'completed' && counts.tool === 1 && phase === 'idle', JSON.stringify({ first: first.outcome, second: second.outcome, counts, phase }))
}

// 6. fenced：state save 412 → fenced → rearm attempts=1；llm 已跑一次，tool 未跑
{
  const cas = newCas()
  const sid = `m2-fenced-${now}`
  putState(cas, sid, waitingFrag(`t-fenced-${now}`))
  putAlarm(cas, sid, now - 1)
  let fencedOnce = false
  const state = {
    get: (key) => cas.get(key),
    putCas: (key, body, cond) => {
      if (!fencedOnce && key === `dsh-mini/state/local/${sid}`) { fencedOnce = true; return { status: 412 } }
      return cas.putCas(key, body, cond)
    },
    listPrefix: (prefix) => cas.listPrefix(prefix),
    del: (key) => cas.del(key),
  }
  const { io, counts } = makeIo(cas)
  io.state = state
  const first = await host.sweepTick(ctx(io), { batchLimit: 10 })
  const keys = cas.listPrefix('dsh-mini/alarms/local/')
  const rec = keys.length === 1 ? JSON.parse(cas.get(keys[0]).body) : null
  check('m2:fenced-rearm', first.length === 1 && first[0].outcome === 'fenced' && keys.length === 1 && rec?.attempts === 1 && rec?.dueAt > Date.now() && counts.tool === 0 && counts.llm === 1, JSON.stringify({ first, keys, rec, counts }))
}

const result = evidence.finish({
  sim: 'sim-wx-alarm',
  endpoint: 'memory-cas',
  control_mock: ['real-kernel', 'real-host-sweepTick', 'memory-cas'],
  note: 'M2 local sweeper：idle / waiting tool / claim-denied / rearm-abandon / killAfter；不触外部数据面',
  shots: [],
})
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === 'm2-pass' ? 0 : 1)
