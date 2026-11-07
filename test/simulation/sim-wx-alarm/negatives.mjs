// sim-wx-alarm · M1 contract 负例矩阵（本地 dev.mjs + memory S3；不触生产/测试桶）。
// 用法: node test/simulation/sim-wx-alarm/negatives.mjs
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openEvidence } from '../lib/evidence.mjs'
import { TEST_OID, OTHER_OID } from '../lib/env.mjs'
import { devTicket, post, startLiveGateway } from '../lib/gateway.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const evidence = openEvidence(dir, 'negatives')
const gw = await startLiveGateway()
const now = Date.now()
const ticket = await devTicket(gw.base, gw.admin, TEST_OID)
const other = await devTicket(gw.base, gw.admin, OTHER_OID)

const check = (name, ok, detail) => evidence.check(name, ok === true, detail)
const due = (sid, dueAt) => post(gw.base, '/v1/state/put-cas', ticket, {
  key: `alarms/${dueAt}-${sid}`,
  body: JSON.stringify({ sessionId: sid, kind: 'turn-resume', dueAt, fence: 'new' }),
  cond: { ifNoneMatch: '*' },
})
const listDue = (t = ticket, at = now) => post(gw.base, '/v1/alarm/due', t, { now: at })

try {
  const noAuth = await post(gw.base, '/v1/alarm/due', '', { now })
  check('auth:no-ticket-401', noAuth.status === 401, `status=${noAuth.status}`)
  const badAuth = await post(gw.base, '/v1/alarm/due', 'bad.token.sig', { now })
  check('auth:bad-ticket-401', badAuth.status === 401, `status=${badAuth.status}`)
  const badShape = await post(gw.base, '/v1/state/put-cas', ticket, { key: 'foo/x', body: '{}', cond: { ifNoneMatch: '*' } })
  check('key:bad-shape-400', badShape.status === 400, `status=${badShape.status}`)
  const traversal = await post(gw.base, '/v1/state/put-cas', ticket, { key: 'alarms/../x', body: '{}', cond: { ifNoneMatch: '*' } })
  check('key:traversal-400', traversal.status === 400, `status=${traversal.status}`)

  const futureSid = `neg-future-${now}`
  const futureAt = now + 3_600_000
  check('alarm:future-arm', (await due(futureSid, futureAt)).status === 200, 'future arm')
  const futureList = await listDue()
  check('due:future-not-listed', !(futureList.body?.keys ?? []).includes(`alarms/${futureAt}-${futureSid}`), JSON.stringify(futureList.body?.keys ?? []))

  const boundarySid = `neg-boundary-${now}`
  check('alarm:boundary-arm', (await due(boundarySid, now - 1)).status === 200, 'boundary arm')
  const boundaryList = await listDue()
  check('due:boundary-listed', (boundaryList.body?.keys ?? []).includes(`alarms/${now - 1}-${boundarySid}`), JSON.stringify(boundaryList.body?.keys ?? []))

  const nanKey = `alarms/NaN-neg-nan-${now}`
  const nanArm = await post(gw.base, '/v1/state/put-cas', ticket, { key: nanKey, body: JSON.stringify({ sessionId: 'neg-nan', kind: 'turn-resume', dueAt: now, fence: 'new' }), cond: { ifNoneMatch: '*' } })
  const nanList = await listDue()
  check('due:nan-skipped', nanArm.status === 200 && !(nanList.body?.keys ?? []).includes(nanKey), JSON.stringify(nanList.body?.keys ?? []))

  const missing = await post(gw.base, '/v1/alarm/claim', ticket, { key: `does-not-exist-${now}`, holder: 'neg' })
  check('claim:missing-404', missing.status === 404, `status=${missing.status}`)

  const seqSid = `neg-seq-${now}`
  const seqAt = now - 1
  await due(seqSid, seqAt)
  const seq1 = await post(gw.base, '/v1/alarm/claim', ticket, { key: `${seqAt}-${seqSid}`, holder: 'neg' })
  const seq2 = await post(gw.base, '/v1/alarm/claim', ticket, { key: `${seqAt}-${seqSid}`, holder: 'neg' })
  check('claim:sequential-200-404', seq1.status === 200 && seq2.status === 404, `first=${seq1.status} second=${seq2.status}`)

  const conSid = `neg-con-${now}`
  const conAt = now - 2
  await due(conSid, conAt)
  const [c1, c2] = await Promise.all([
    post(gw.base, '/v1/alarm/claim', ticket, { key: `${conAt}-${conSid}`, holder: 'a' }),
    post(gw.base, '/v1/alarm/claim', ticket, { key: `${conAt}-${conSid}`, holder: 'b' }),
  ])
  const statuses = [c1.status, c2.status].sort()
  check('claim:concurrent-exactly-one', statuses[0] === 200 && statuses[1] === 404, `statuses=${statuses.join(',')}`)

  const crossSid = `neg-cross-${now}`
  const crossAt = now - 3
  await due(crossSid, crossAt)
  const crossList = await listDue(other)
  check('oid:cross-not-listed', !(crossList.body?.keys ?? []).includes(`alarms/${crossAt}-${crossSid}`), JSON.stringify(crossList.body?.keys ?? []))

  const result = evidence.finish({
    sim: 'sim-wx-alarm',
    endpoint: gw.base,
    control_mock: ['clock-request-now'],
    note: 'M1 contract negatives；本地 dev.mjs + memory S3；不触生产/测试桶',
    shots: [],
  })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.status === 'negatives-pass' ? 0 : 1)
} finally {
  await gw.close()
}
