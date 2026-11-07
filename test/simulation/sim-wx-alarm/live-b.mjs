// Live-B：公网 https 测试网关 + sweeper-test + sim_echo 的完整 cloud 近似 journey。
// 只写 test bucket；real oid 来自 byok_keys（不写生产桶）。
// 证：due alarm → 真 30s sweeper → resume pending tool → sim_echo 恰一次 → finish。
import fs from 'node:fs'
import crypto from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { openEvidence } from '../lib/evidence.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const kernelMod = require('../../../cloud/functions/sweeper/vendor/kernel.cjs')
const kernel = kernelMod.kernel ?? kernelMod

const LOCAL = 'http://127.0.0.1:9095'
const PUBLIC = 'https://dsh-mini-test.saobao.com'
const REAL_OID = 'ogtyS5GNQegjCKFiERFiYnUBpjVU'
const now = Date.now()
const sid = `sim-wx-alarm-live-b-${now}`
const counterKey = `state/sim-tool-count-${sid}`
const dueTs = now - 1000

function loadEnv() {
  const env = {}
  for (const line of fs.readFileSync(join(dir, '../../../.anote/frd1/gateway.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  if (!env.ADMIN_TOKEN) throw new Error('ADMIN_TOKEN missing')
  return env
}

const admin = loadEnv().ADMIN_TOKEN
async function devTicket() {
  const r = await fetch(`${LOCAL}/dev/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': admin },
    body: JSON.stringify({ oid: REAL_OID, ttl_s: 1800 }),
  })
  const body = await r.json().catch(() => null)
  if (r.status !== 200 || typeof body?.ticket !== 'string') throw new Error(`/dev/ticket ${r.status} ${JSON.stringify(body).slice(0, 160)}`)
  return body.ticket
}
const ticket = await devTicket()
async function call(base, ep, payload) {
  const r = await fetch(`${base}/v1/${ep}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ticket}` },
    body: JSON.stringify(payload),
  })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: r.status, body }
}

// pending sim_echo：llmFinished=true，scheduler 直接 tool_exec，不走 LLM。
let snap = kernel.createKernelSnapshot(kernel.createInitialSessionState())
snap = kernel.applyAction(snap, { type: 'start_turn', turnId: `live-b-${now}` })
snap = kernel.applyAction(snap, {
  type: 'tool_calls_requested',
  calls: [{ id: `sim-call-${now}`, name: 'sim_echo', input: { counter_key: counterKey } }],
  textContent: null,
})
const frag = kernel.buildCheckpointFragment(snap)

const evidence = openEvidence(dir, 'live-b')
const stateKey = `state/${sid}`
const alarmKey = `alarms/${dueTs}-${sid}`
const claimKey = `claims/${sid}`

const health = await fetch(`${PUBLIC}/healthz`).then((r) => r.json()).catch(() => null)
evidence.check('gateway:public-healthz', health?.ok === true && health?.bucket === 'dsh-mini-test', JSON.stringify(health))

const putState = await call(LOCAL, 'state/put-cas', { key: stateKey, body: JSON.stringify(frag), cond: { ifNoneMatch: '*' } })
const putAlarm = await call(LOCAL, 'state/put-cas', { key: alarmKey, body: JSON.stringify({ sessionId: sid, kind: 'turn-resume', dueAt: dueTs, fence: 'new' }), cond: { ifNoneMatch: '*' } })
evidence.check('alarm:arm', putState.status === 200 && putAlarm.status === 200, JSON.stringify({ putState, putAlarm }))

const started = Date.now()
let alarmGet = null
for (let i = 0; i < 30; i++) {
  alarmGet = await call(LOCAL, 'state/get', { key: alarmKey })
  if (alarmGet.status === 404) break
  await new Promise((r) => setTimeout(r, 3000))
}
const consumedMs = Date.now() - started
evidence.check('alarm:consumed', alarmGet?.status === 404, `status=${alarmGet?.status} after ${consumedMs}ms`)

const stateGet = await call(LOCAL, 'state/get', { key: stateKey })
let phase = null
let activeTurn = null
try {
  const body = JSON.parse(stateGet.body.body)
  phase = body?.session?.phase ?? null
  activeTurn = body?.activeTurn ?? null
} catch { /* leave null */ }
evidence.check('state:idle', stateGet.status === 200 && phase === 'idle' && activeTurn === null, `status=${stateGet.status} phase=${phase} activeTurn=${activeTurn ? 'present' : 'null'}`)

const counterGet = await call(LOCAL, 'state/get', { key: counterKey })
let count = null
try { count = Number(JSON.parse(counterGet.body.body).count) } catch { /* leave null */ }
evidence.check('tool:exactly-once', counterGet.status === 200 && count === 1, `status=${counterGet.status} count=${count}`)

const claimGet = await call(LOCAL, 'state/get', { key: claimKey })
let holder = null
try { holder = JSON.parse(claimGet.body.body)?.holder ?? null } catch { /* leave null */ }
evidence.check('claim:holder', claimGet.status === 200 && typeof holder === 'string' && holder.startsWith('sweeper-'), `status=${claimGet.status} holder=${holder}`)

const due = await call(LOCAL, 'alarm/due', { now: Date.now() })
const stillDue = (due.body?.keys ?? []).includes(`alarms/${dueTs}-${sid}`)
evidence.check('alarm:no-residual', due.status === 200 && !stillDue, `due=${JSON.stringify(due.body?.keys ?? [])}`)

const result = evidence.finish({
  sim: 'sim-wx-alarm',
  mode: 'live-b',
  endpoint: PUBLIC,
  status: 'live-pass',
  control_mock: ['test-gateway', 'test-sweeper', 'sim-echo-tool'],
  deferred: ['ui'],
  note: 'Live B cloud test topology：public https test gateway + sweeper-test；real oid；test bucket；sim_echo tool=1；no production write；UI deferred',
})
console.log(JSON.stringify(result, null, 2))
process.exit(result.status === 'live-pass' ? 0 : 1)
