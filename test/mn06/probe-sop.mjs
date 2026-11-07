// MN06-T15 —— `probe/` 键区扩展 SOP：只在 probe 窗口运行。
//
// 前置：`cloud/worker/worker.mjs` 的键区正则已临时加入 `probe`；本测试自己 spawn
// `cloud/durable/dev.mjs`（随机端口、真 MinIO），经 `/v1/state/*` + byok 票写/读
// `probe/hello`，断言 PUT 200 / GET 200 / 条件写 412，且票 scope 仍为 `byok-proxy`。
// 未加 probe 时 exit 3（未观察，不算 PASS）；SOP 后 worker 必须 revert。
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { ROOT, loadEnv, requireEnv, assertMode600, mintTicket, report } from './env.mjs'

const WORKER = join(ROOT, 'cloud/worker/worker.mjs')
const source = readFileSync(WORKER, 'utf8')
if (!/\(state\|claims\|alarms\|probe\)/.test(source)) {
  console.error('[probe-sop] probe 未启用（SOP 窗口外）；exit 3')
  process.exit(3)
}

const env = loadEnv()
try {
  assertMode600()
  requireEnv(env, ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
} catch (e) {
  console.error(`[probe-sop] env: ${e?.message ?? e}`)
  process.exit(3)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  s.on('error', reject)
})
const port = await freePort()
const base = `http://127.0.0.1:${port}`

const child = spawn(process.execPath, [join(ROOT, 'cloud/durable/dev.mjs')], {
  env: {
    ...process.env,
    TICKET_SECRET: env.TICKET_SECRET,
    ADMIN_TOKEN: env.ADMIN_TOKEN,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_BUCKET: env.S3_BUCKET,
    S3_REGION: env.S3_REGION,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    PUBLIC_BASE: base,
    API_PORT: String(port),
    API_BIND: '127.0.0.1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (d) => { log += d })
child.stderr.on('data', (d) => { log += d })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}

async function ready(timeoutMs = 15000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/healthz`)
      if (r.status === 200) return true
    } catch { /* starting */ }
    await sleep(200)
  }
  return false
}

const call = async (ep, body, ticket) => {
  const r = await fetch(`${base}/v1/${ep}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ticket}` },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-json */ }
  return { status: r.status, json, text }
}

try {
  if (!(await ready())) throw new Error(`dev entry 未就绪:\n${log.slice(-800)}`)
  const ticket = await mintTicket({ ...env, DURABLE: base }, env.TEST_OID)
  const payload = JSON.parse(Buffer.from(ticket.split('.')[1], 'base64url').toString('utf8'))
  check('probe:ticket scope=byok-proxy', payload.scope === 'byok-proxy', `scope=${payload.scope} oid=${payload.oid}`)

  const put1 = await call('state/put-cas', { key: 'probe/hello', body: '{"probe":"hello"}', cond: { ifNoneMatch: '*' } }, ticket)
  check('probe:PUT 200', put1.status === 200 && typeof put1.json?.etag === 'string', `status=${put1.status}`)

  const got = await call('state/get', { key: 'probe/hello' }, ticket)
  check('probe:GET 200', got.status === 200 && got.json?.body === '{"probe":"hello"}', `status=${got.status} body=${JSON.stringify(got.json?.body)}`)

  const put2 = await call('state/put-cas', { key: 'probe/hello', body: '{"probe":"again"}', cond: { ifNoneMatch: '*' } }, ticket)
  check('probe:条件写 412', put2.status === 412 && put2.json?.error === 'etag-conflict', `status=${put2.status}`)
} catch (e) {
  check('probe:run', false, String(e?.stack ?? e).slice(0, 800))
} finally {
  try { child.kill('SIGTERM') } catch { /* gone */ }
  await sleep(250)
}

const failed = results.filter((r) => !r.ok)
const payload = report('mn06-probe-sop', results.map((r) => ({ id: r.name, pass: r.ok })), {
  ran_at: new Date().toISOString(),
  commit: process.env.GIT_COMMIT ?? '',
  probe_key: 'probe/hello',
})
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()} port=${port}`)
if (failed.length > 0) process.exit(1)
