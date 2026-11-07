// Live-A：生产公网 https + 合成 oid 的 alarm transport 证据。
// 只证：alarm 行写入 → 云函数 sweeper 真 30s 消费 → alarm 恰一次 → state 仍 idle。
// 不证：resume / tool（见 deferred）。byok_keys 记录由外部 provision/cleanup。
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { openEvidence } from '../lib/evidence.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const kernelMod = require('../../../cloud/functions/sweeper/vendor/kernel.cjs')
const kernel = kernelMod.kernel ?? kernelMod

const BASE = 'https://dsh-mini.saobao.com'
const META = process.env.SIM_LIVE_A_META ?? '/private/tmp/wxalarm-live-a-meta.json'
const meta = JSON.parse(fs.readFileSync(META, 'utf8'))
const APPID = 'wx356d3abb52825466'
const ENV = 'cloud1-d7gar8j7w419589a0'

function loadSecret() {
  const env = {}
  for (const line of fs.readFileSync(join(dir, '../../../.env.wx.cloud'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  if (!env.TICKET_SECRET) throw new Error('TICKET_SECRET missing')
  return env.TICKET_SECRET
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function mint(oid) {
  const secret = loadSecret()
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ oid, scope: 'byok-proxy', jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

const ticket = mint(meta.oid)
async function call(ep, payload) {
  const r = await fetch(`${BASE}/v1/${ep}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ticket}` },
    body: JSON.stringify(payload),
  })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: r.status, body }
}

function byokCount() {
  const out = execFileSync('wechatide', [
    '-c', 'wechat-devtools', 'cloud_db_read_doc',
    '--appid', APPID, '--env', ENV, '--collection-name', 'byok_keys',
    '--query', JSON.stringify({ openid: meta.oid }), '--limit', '5',
  ], { encoding: 'utf8', timeout: 60_000 })
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)
  const parsed = JSON.parse(json)
  return parsed?.result?.data?.length ?? 0
}

const evidence = openEvidence(dir, 'live-a')
const frag = kernel.buildCheckpointFragment(kernel.createKernelSnapshot(kernel.createInitialSessionState()))
const stateKey = `state/${meta.sid}`
const alarmKey = `alarms/${meta.dueTs}-${meta.sid}`
const claimKey = `claims/${meta.sid}`

const putState = await call('state/put-cas', { key: stateKey, body: JSON.stringify(frag), cond: { ifNoneMatch: '*' } })
const putAlarm = await call('state/put-cas', { key: alarmKey, body: JSON.stringify({ sessionId: meta.sid, kind: 'turn-resume', dueAt: meta.dueTs, fence: 'new' }), cond: { ifNoneMatch: '*' } })
evidence.check('alarm:arm', putState.status === 200 && putAlarm.status === 200, JSON.stringify({ putState, putAlarm }))
evidence.check('byok:present', byokCount() > 0, `oid=${meta.oid}`)

const started = Date.now()
let alarmGet = null
for (let i = 0; i < 30; i++) {
  alarmGet = await call('state/get', { key: alarmKey })
  if (alarmGet.status === 404) break
  await new Promise((r) => setTimeout(r, 3000))
}
const consumedMs = Date.now() - started
evidence.check('alarm:consumed', alarmGet?.status === 404, `status=${alarmGet?.status} after ${consumedMs}ms`)

const stateGet = await call('state/get', { key: stateKey })
let phase = null
let activeTurn = null
try {
  const body = JSON.parse(stateGet.body.body)
  phase = body?.session?.phase ?? null
  activeTurn = body?.activeTurn ?? null
} catch { /* leave null */ }
evidence.check('state:idle', stateGet.status === 200 && phase === 'idle' && activeTurn === null, `status=${stateGet.status} phase=${phase} activeTurn=${activeTurn ? 'present' : 'null'}`)

const claimGet = await call('state/get', { key: claimKey })
let holder = null
try { holder = JSON.parse(claimGet.body.body)?.holder ?? null } catch { /* leave null */ }
evidence.check('claim:holder', claimGet.status === 200 && typeof holder === 'string' && holder.startsWith('sweeper-'), `status=${claimGet.status} holder=${holder}`)

const due = await call('alarm/due', { now: Date.now() })
const stillDue = (due.body?.keys ?? []).includes(`alarms/${meta.dueTs}-${meta.sid}`)
evidence.check('alarm:no-residual', due.status === 200 && !stillDue, `due=${JSON.stringify(due.body?.keys ?? [])}`)

const result = evidence.finish({
  sim: 'sim-wx-alarm',
  endpoint: BASE,
  control_mock: ['production-synthetic-oid', 'local-ticket-mint', 'byok-keys-provision'],
  deferred: ['resume', 'tool'],
  note: 'Live A cloud transport only；合成 oid；云函数 sweeper 真 30s；state/claim 行因 B-06 无删除端点残留',
})
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === 'live-a-pass' || result.status === 'live-pass' ? 0 : 1)
