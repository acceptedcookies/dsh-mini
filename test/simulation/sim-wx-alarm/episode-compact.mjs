// sim-wx-alarm · episode/compaction 泵级验证（真实 kernel + 真实 host + 内存 CAS）。
// T-O-12 genesis 账行保持不变；T-O-20 ③ / P5-02：96KB 字节近似已退役。
// 本文件验证「大 transcript 不再触发压缩」：无子 episode、无 compact_done、无 artifact。
// 用法: node test/simulation/sim-wx-alarm/episode-compact.mjs
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { openEvidence } from '../lib/evidence.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const kernelMod = require('../../../cloud/functions/sweeper/vendor/kernel.cjs')
const kernel = kernelMod.kernel ?? kernelMod
globalThis.__dshKernelBundle = kernel
const host = require('../../../cloud/functions/sweeper/vendor/host.cjs')

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

const ctx = (io) => ({ kernel, io, owner: 'local', holder: 'p6-host' })
const now = Date.now()
const BIG = 'x'.repeat(120 * 1024) // >96KB，旧实现会在这里触发压缩

function readSnap(cas, sid) {
  const row = cas.get(`dsh-mini/state/local/${sid}`)
  if (row === null) return null
  const p = JSON.parse(row.body)
  return { envelope: p.frag !== undefined, frag: p.frag ?? p, ep: p.ep ?? null }
}
const epRows = (cas) => cas.listPrefix('dsh-mini/episodes/local/')
  .map((k) => ({ key: k, row: JSON.parse(cas.get(k).body) }))

// 1. genesis：新会话首泵 → snapshot 信封带 ep 段 + episodes/{uuid} genesis 账行
{
  const cas = newCas()
  const sid = `p6-genesis-${now}`
  const io = {
    state: cas,
    llm: async function* () {
      yield { kind: 'content', text: 'final' }
      yield { kind: 'done' }
    },
    tool: async () => ({ kind: 'inline-text', text: 'ok' }),
  }
  const r = await host.runPump(ctx(io), sid, { input: 'hi', maxSteps: 5 })
  const snap = readSnap(cas, sid)
  const rows = epRows(cas)
  check('ep:genesis-envelope', r.outcome === 'completed' && snap !== null && snap.envelope && typeof snap.ep?.uuid === 'string' && snap.ep.seq > 0, JSON.stringify({ outcome: r.outcome, ep: snap?.ep?.uuid, seq: snap?.ep?.seq }))
  check('ep:genesis-ledger', rows.length === 1 && rows[0].row.trigger_kind === 'genesis' && rows[0].row.episode_uuid === snap.ep.uuid && rows[0].row.head_event_seq === 0, JSON.stringify(rows.map((x) => x.row)))
  check('ep:events-tagged', (snap.ep?.events ?? []).every((e) => e.episode_uuid === snap.ep.uuid && e.event_seq >= 1), `n=${snap.ep?.events?.length}`)
}

// 2. 大 transcript 不再因字节数压缩：无子账行、compactCount 仍 0、无 artifact、无残留 claim
{
  const cas = newCas()
  const sid = `p6-big-${now}`
  const published = []
  let calls = 0
  const io = {
    state: cas,
    llm: async function* () {
      calls += 1
      yield { kind: 'content', text: calls === 1 ? BIG : 'final' }
      yield { kind: 'done' }
    },
    tool: async () => ({ kind: 'inline-text', text: 'ok' }),
    artifacts: {
      async publishJson(obj) { const sha = `sha-${published.length}`; published.push({ sha, obj }); return { sha256: sha } },
    },
  }
  const r = await host.runPump(ctx(io), sid, { input: 'go', maxSteps: 10 })
  const snap = readSnap(cas, sid)
  const rows = epRows(cas)
  const child = rows.find((x) => x.row.trigger_kind === 'compact_required')
  const compactCount = snap?.frag?.session?.compactCount ?? 0
  const replayDoc = published.find((p) => p.obj.kind === 'episode-replay')
  const sumDoc = published.find((p) => p.obj.kind === 'episode-summary')
  check('ep:big-completed', r.outcome === 'completed' && snap !== null && snap.envelope, JSON.stringify({ outcome: r.outcome, trace: r.trace }))
  check('ep:no-byte-compact', child === undefined && compactCount === 0, JSON.stringify({ child: child?.row?.trigger_kind, compactCount }))
  check('ep:no-artifacts', replayDoc === undefined && sumDoc === undefined, `published=${published.length}`)
  check('ep:no-compact-claim', cas.get(`dsh-mini/claims/local/compact-${sid}`) === null)
}

// 3. 对手占用 compact 标记也不影响：不压缩就不读这个标记
{
  const cas = newCas()
  const sid = `p6-rival-${now}`
  cas.putCas(`dsh-mini/claims/local/compact-${sid}`, JSON.stringify({ holder: 'rival', expires: new Date(Date.now() + 60000).toISOString() }), { ifNoneMatch: '*' })
  const io = {
    state: cas,
    llm: async function* () {
      yield { kind: 'content', text: BIG }
      yield { kind: 'done' }
    },
    tool: async () => ({ kind: 'inline-text', text: 'ok' }),
  }
  const r = await host.runPump(ctx(io), sid, { input: 'go', maxSteps: 10 })
  const rows = epRows(cas).filter((x) => x.row.trigger_kind === 'compact_required')
  check('ep:rival-no-compact', r.outcome === 'completed' && rows.length === 0, JSON.stringify({ outcome: r.outcome, rows: rows.length }))
}

const result = evidence.finish({
  sim: 'sim-wx-alarm/episode-compact',
  endpoint: 'memory-cas',
  control_mock: ['real-kernel', 'real-host', 'memory-cas', 'scripted-llm', 'mock-artifacts-sha'],
  note: 'T-O-12 genesis 账行；T-O-20 ③ 大 transcript 不做字节压缩（无子 episode/无 artifact）',
})
console.log(JSON.stringify({ status: result.status, checks: result.checks.length }, null, 2))
process.exit(result.status === 'm2-pass' ? 0 : 1)
