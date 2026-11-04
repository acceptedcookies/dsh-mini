// MN01-T08 sim 端点语义测试：起独立 sim 实例（独立 CAS 后端，非共享 Map），
// 双 openid 票据 → 键区隔离矩阵 + CAS/claim/alarm 语义 + openid 注入校验。
// 用法：node test/mn01/endpoints.mjs（自起 sim 于 127.0.0.1:3499，结束回收）
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'package.json'))
const { signTicket } = require(join(repo, 'cloud/lib/ticket.cjs'))
const PORT = 3499
// 独立 DB：sim 用 cwd 派生 DB_PATH——tmpdir 独立实例 = 独立 CAS 后端（T08 独立实例要求）
const env = { ...process.env, SIM_PORT: String(PORT), SIM_DB_DIR: mkdtempSync(join(tmpdir(), 'mn01-sim-')) }
const sim = spawn('node', [join(repo, 'cloud/sim/server.mjs')], { env, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1200))

const mint = (oid) => signTicket('sim-ticket-secret-dev', { oid, scope: 'byok-proxy', jti: `t-${oid}`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })
const post = (oid, ep, body) => fetch(`http://127.0.0.1:${PORT}/sim/v1/${ep}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${mint(oid)}` },
  body: JSON.stringify(body),
}).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }))

const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`) }

try {
  // 用户A写 state → 用户B 读不到（openid 注入隔离）
  await post('alice', 'state/put-cas', { key: 'state/s1', body: 'A-secret', cond: { ifNoneMatch: '*' } })
  const bRead = await post('bob', 'state/get', { key: 'state/s1' })
  check('iso:cross-user-read-404', bRead.s === 404, `bob read alice state → ${bRead.s}`)
  const bOver = await post('bob', 'state/put-cas', { key: 'state/s1', body: 'B', cond: {} })
  check('iso:bob-own-write', bOver.s === 200, 'bob 写自己同 key → 200（不同键区）')
  const aRead = await post('alice', 'state/get', { key: 'state/s1' })
  check('iso:alice-unmoved', aRead.b.body === 'A-secret', `alice 行未被覆盖：${aRead.b.body}`)

  // 请求体携带伪造 openid 字段 → 被忽略（服务端注入为准）
  await post('alice', 'state/put-cas', { key: 'state/spoof', body: 'x', openid: 'bob', cond: {} })
  const sp = await post('bob', 'state/get', { key: 'state/spoof' })
  check('spoof:body-openid-ignored', sp.s === 404, `body.openid=bob 未生效 → ${sp.s}`)

  // 键形校验：无 kind 前缀的键 400
  const badKey = await post('alice', 'state/get', { key: 'dsh-mini/state/x/s1' })
  check('shape:dsh-mini-rejected', badKey.s === 400, `全键直通被拒 → ${badKey.s}`)

  // claim 语义：live rival 412 / 过期接管 200
  await post('alice', 'claim', { key: 's1', holder: 'w1', ttlMs: 60000 })
  const rival = await post('alice', 'claim', { key: 's1', holder: 'w2', ttlMs: 60000 })
  check('claim:rival-412', rival.s === 412 && rival.b.holder === 'w1', `→ ${JSON.stringify(rival.b)}`)
  const crossClaim = await post('bob', 'claim', { key: 's1', holder: 'w3', ttlMs: 60000 })
  check('claim:cross-user-independent', crossClaim.s === 200, 'bob claims 同 sid 独立（键区隔离）')

  // alarm：due 列举按用户收窄 + 原子消费
  await post('alice', 'state/put-cas', { key: 'alarms/1-sa', body: JSON.stringify({ dueAt: 1, sessionId: 'sa' }), cond: {} })
  const aDue = await post('alice', 'alarm/due', {})
  check('alarm:due-scoped', aDue.b.keys?.includes('alarms/1-sa'), `alice due=${JSON.stringify(aDue.b.keys)}`)
  const bDue = await post('bob', 'alarm/due', {})
  check('alarm:due-cross-user-empty', !(bDue.b.keys ?? []).includes('alarms/1-sa'), `bob due=${JSON.stringify(bDue.b.keys)}`)
  const ac = await post('alice', 'alarm/claim', { key: '1-sa', holder: 'sweep' })
  check('alarm:claim-atomic', ac.s === 200 && ac.b.body.includes('sa'), `→ ${ac.s}`)
  const ac2 = await post('alice', 'alarm/claim', { key: '1-sa', holder: 'sweep' })
  check('alarm:claim-once', ac2.s === 404, '二次 claim → 404（幂等）')
} finally {
  sim.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
