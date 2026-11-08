// sim-wx-alarm · P6 episode/compaction 泵级验证（真实 kernel + 真实 host + 内存 CAS）。
// 覆盖 T-O-12：genesis 账行 / compact 真路径 / episode 边界事件归属 / claims 标记释放。
// 用法: node test/simulation/sim-wx-alarm/episode-compact.mjs
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

const ctx = (io) => ({ kernel, io, owner: 'local', holder: 'p6-host' })
const now = Date.now()
const BIG = 'x'.repeat(120 * 1024) // >96KB → compactRequired 触发

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
    llm: async () => ({ text: 'final', usage: {} }),
    tool: async () => ({ kind: 'inline-text', text: 'ok' }),
  }
  const r = await host.runPump(ctx(io), sid, { input: 'hi', maxSteps: 5 })
  const snap = readSnap(cas, sid)
  const rows = epRows(cas)
  check('ep:genesis-envelope', r.outcome === 'completed' && snap !== null && snap.envelope && typeof snap.ep?.uuid === 'string' && snap.ep.seq > 0, JSON.stringify({ outcome: r.outcome, ep: snap?.ep?.uuid, seq: snap?.ep?.seq }))
  check('ep:genesis-ledger', rows.length === 1 && rows[0].row.trigger_kind === 'genesis' && rows[0].row.episode_uuid === snap.ep.uuid && rows[0].row.head_event_seq === 0, JSON.stringify(rows.map((x) => x.row)))
  check('ep:events-tagged', (snap.ep?.events ?? []).every((e) => e.episode_uuid === snap.ep.uuid && e.event_seq >= 1), `n=${snap.ep?.events?.length}`)
}

// 2. compact 真路径：>96KB messages → kernel compact → 账行链 + summary/replay artifact + 新 ep + compact_done
{
  const cas = newCas()
  const sid = `p6-compact-${now}`
  const published = []
  let calls = 0
  const io = {
    state: cas,
    llm: async (messages) => {
      calls += 1
      const c = JSON.stringify(messages)
      if (c.includes('Summarize this agent conversation')) return { text: 'SUMMARY-BODY', usage: {} }
      return calls === 1 ? { text: BIG, usage: {} } : { text: 'final', usage: {} }
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
  const replayDoc = published.find((p) => p.obj.kind === 'episode-replay')
  const sumDoc = published.find((p) => p.obj.kind === 'episode-summary')
  // turn 完成后 activeTurn 已清——断 compact_done 生效看 kernel 计数器 compactCount。
  const compactCount = snap?.frag?.session?.compactCount ?? 0
  check('ep:compact-completed', r.outcome === 'completed' && snap !== null && snap.envelope, JSON.stringify({ outcome: r.outcome, trace: r.trace }))
  check('ep:compact-ledger-child', child !== undefined && child.row.parent_episode_uuid !== undefined && child.row.episode_uuid === snap.ep.uuid && child.row.summary_sha === 'sha-1' && child.row.replay_sha === 'sha-0', JSON.stringify(child?.row))
  check('ep:replay-artifact', replayDoc !== undefined && replayDoc.obj.events.length > 0 && replayDoc.obj.events.every((e) => e.episode_uuid === child?.row.parent_episode_uuid), `events=${replayDoc?.obj.events.length}`)
  check('ep:summary-artifact', sumDoc !== undefined && sumDoc.obj.summary === 'SUMMARY-BODY' && sumDoc.obj.replay_sha === 'sha-0', JSON.stringify(sumDoc?.obj.episode_uuid))
  check('ep:compact_done-messages', compactCount >= 1, `compactCount=${compactCount}`)
  check('ep:marker-released', cas.get(`dsh-mini/claims/local/compact-${sid}`) === null)
  check('ep:seq-monotonic', snap.ep.seq > child.row.head_event_seq || snap.ep.seq >= child.row.head_event_seq, `seq=${snap.ep.seq} head=${child.row.head_event_seq}`)
}

// 3. compact 标记被对手持有 → suspended、无新账行、ep 不换
{
  const cas = newCas()
  const sid = `p6-rival-${now}`
  cas.putCas(`dsh-mini/claims/local/compact-${sid}`, JSON.stringify({ holder: 'rival', expires: new Date(Date.now() + 60000).toISOString() }), { ifNoneMatch: '*' })
  const io = {
    state: cas,
    llm: async (messages) => {
      const c = JSON.stringify(messages)
      if (c.includes('Summarize this agent conversation')) return { text: 'SUM', usage: {} }
      return { text: BIG, usage: {} }
    },
    tool: async () => ({ kind: 'inline-text', text: 'ok' }),
  }
  const r = await host.runPump(ctx(io), sid, { input: 'go', maxSteps: 10 })
  const snap = readSnap(cas, sid)
  const rows = epRows(cas).filter((x) => x.row.trigger_kind === 'compact_required')
  check('ep:rival-suspended', r.outcome === 'suspended' && rows.length === 0, JSON.stringify({ outcome: r.outcome, rows: rows.length }))
}

// 4. 无 artifacts 车道降级：summary_text 内嵌账行（summary_sha 缺位）
{
  const cas = newCas()
  const sid = `p6-degrade-${now}`
  const io = {
    state: cas,
    llm: async (messages) => {
      const c = JSON.stringify(messages)
      return c.includes('Summarize this agent conversation') ? { text: 'INLINE-SUM', usage: {} } : { text: BIG, usage: {} }
    },
    tool: async () => ({ kind: 'inline-text', text: 'ok' }),
  }
  const r = await host.runPump(ctx(io), sid, { input: 'go', maxSteps: 10 })
  const rows = epRows(cas)
  const child = rows.find((x) => x.row.trigger_kind === 'compact_required')
  check('ep:degrade-inline', r.outcome === 'completed' && child !== undefined && child.row.summary_sha === undefined && child.row.summary_text === 'INLINE-SUM', JSON.stringify({ outcome: r.outcome, child: child?.row }))
}

const result = evidence.finish({
  sim: 'sim-wx-alarm/episode-compact',
  endpoint: 'memory-cas',
  control_mock: ['real-kernel', 'real-host', 'memory-cas', 'scripted-llm', 'mock-artifacts-sha'],
  note: 'P6 T-O-12：genesis/compact 账行链、episode 边界事件归属、claims 标记、artifacts 降级面',
})
console.log(JSON.stringify({ status: result.status, checks: result.checks.length }, null, 2))
process.exit(result.status === 'm2-pass' ? 0 : 1)
