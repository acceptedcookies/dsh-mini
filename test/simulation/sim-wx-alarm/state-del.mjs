// P6-03/P6-07 — T-O-11 state/del + T-O-12 episodes 键区合同验证（真 dev 网关 + 真 MinIO）。
// 用法：ADMIN_TOKEN + TICKET_SECRET 经 env 注入；DURABLE 指本地 dev 入口。
//   DURABLE=http://127.0.0.1:19095 node test/simulation/sim-wx-alarm/state-del.mjs
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openEvidence } from '../lib/evidence.mjs'

const SIM = dirname(fileURLToPath(import.meta.url))
const BASE = (process.env.DURABLE ?? 'http://127.0.0.1:19095').replace(/\/$/, '')
const ADMIN = process.env.ADMIN_TOKEN ?? ''
const OID = `p6-probe-${Date.now().toString(36)}`

const ev = openEvidence(SIM, 'local')

const post = async (path, body, tok = '', admin = '') => {
  const headers = { 'content-type': 'application/json' }
  if (tok !== '') headers.authorization = `Bearer ${tok}`
  if (admin !== '') headers['x-admin-token'] = admin
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

// 铸票（dev 入口，x-admin-token 闸 + byok-proxy scope）。
const t = await post('/dev/ticket', { oid: OID }, '', ADMIN)
ev.check('ticket', t.status === 200 && typeof t.body.ticket === 'string', `status=${t.status}`)
const TOK = t.body.ticket ?? ''

const K = `p6/${Date.now()}`
// 1. put-cas → get
const p = await post('/v1/state/put-cas', { key: `state/${K}`, body: JSON.stringify({ v: 1 }), cond: { ifNoneMatch: '*' } }, TOK)
ev.check('put-cas', p.status === 200, `etag=${p.body.etag ?? ''}`)
const g1 = await post('/v1/state/get', { key: `state/${K}` }, TOK)
ev.check('get-200', g1.status === 200 && g1.body.body !== undefined)
// 2. state/del → get 404
const d1 = await post('/v1/state/del', { key: `state/${K}` }, TOK)
ev.check('state-del-200', d1.status === 200, `status=${d1.status}`)
const g2 = await post('/v1/state/get', { key: `state/${K}` }, TOK)
ev.check('get-404-after-del', g2.status === 404)
// 3. 幂等：del 缺失行 → 404
const d2 = await post('/v1/state/del', { key: `state/${K}` }, TOK)
ev.check('del-missing-404', d2.status === 404)
// 4. ifMatch fencing：错 etag → 412，对 etag → 200
await post('/v1/state/put-cas', { key: `state/${K}`, body: '{"v":2}', cond: { ifNoneMatch: '*' } }, TOK)
const g3 = await post('/v1/state/get', { key: `state/${K}` }, TOK)
const dBad = await post('/v1/state/del', { key: `state/${K}`, ifMatch: 'deadbeef' }, TOK)
ev.check('del-ifMatch-412', dBad.status === 412, `status=${dBad.status}`)
const dOk = await post('/v1/state/del', { key: `state/${K}`, ifMatch: g3.body.etag }, TOK)
ev.check('del-ifMatch-200', dOk.status === 200)
// 5. kind 白名单：alarms/ 拒 400；episodes/ 拒 400
await post('/v1/state/put-cas', { key: `alarms/${K}-a`, body: '{"x":1}', cond: { ifNoneMatch: '*' } }, TOK)
const dAlarm = await post('/v1/state/del', { key: `alarms/${K}-a` }, TOK)
ev.check('del-alarms-400', dAlarm.status === 400, `status=${dAlarm.status}`)
await post('/v1/state/put-cas', { key: `episodes/${K}-e`, body: '{"episode_uuid":"e1"}', cond: { ifNoneMatch: '*' } }, TOK)
const dEp = await post('/v1/state/del', { key: `episodes/${K}-e` }, TOK)
ev.check('del-episodes-400', dEp.status === 400, `status=${dEp.status}`)
// 6. episodes/ 键区经 state/get+put-cas 可走（账行读写面）
const gEp = await post('/v1/state/get', { key: `episodes/${K}-e` }, TOK)
ev.check('episodes-get-200', gEp.status === 200 && String(gEp.body.body).includes('e1'))
// 7. claims 行显式释放
await post('/v1/state/put-cas', { key: `claims/${K}-c`, body: '{"holder":"h1","expires":"2099-01-01T00:00:00Z"}', cond: { ifNoneMatch: '*' } }, TOK)
const dCl = await post('/v1/state/del', { key: `claims/${K}-c` }, TOK)
ev.check('del-claims-200', dCl.status === 200)
// 8. 测试数据自清：alarms 行走 alarm/claim 原子消费回收
const dAl = await post('/v1/alarm/claim', { key: `${K}-a`, holder: 'p6-probe' }, TOK)
ev.check('cleanup-alarm', dAl.status === 200 || dAl.status === 404, `status=${dAl.status}`)

const out = ev.finish({ sim: 'sim-wx-alarm/state-del', endpoint: BASE, note: `oid=${OID}` })
console.log(`\n${out.checks.filter((c) => c.ok).length}/${out.checks.length} → ${out.status}`)
process.exit(out.status === 'local-pass' ? 0 : 1)
