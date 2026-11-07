// MN06-T01 —— 合同 parity：pin 住的旧 test-s3 server vs 新 cloud/durable 核心。
//
// 旧实现从 git commit 取 blob（不把第二套实现留在工作树），以同一 env 起在 9096；
// 新实现用 cloud/durable/dev.mjs 起在 9097；同一 MinIO bucket、同一 oid。
// 每个 golden case 以 side 后缀隔离键，按 status + 归一化 JSON 做结构化 diff。
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, loadEnv, requireEnv, assertLocalEndpoint, assertMode600, mintTicket, report, isMain } from './env.mjs'

const LEGACY_COMMIT = '74e8aab'
const RUN = `parity-${Date.now().toString(36)}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const env = loadEnv()
try {
  assertMode600()
  assertLocalEndpoint(env.BASE, 'BASE')
  assertLocalEndpoint(env.DURABLE, 'DURABLE')
  requireEnv(env, ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
} catch (e) {
  console.error(`[parity] env: ${e?.message ?? e}`)
  process.exit(3)
}

const oldRoot = mkdtempSync(join(tmpdir(), 'mn06-parity-'))
const children = []
let oldPort = 9096
let newPort = 9097

function childEnv(port) {
  return {
    ...process.env,
    TICKET_SECRET: env.TICKET_SECRET,
    ADMIN_TOKEN: env.ADMIN_TOKEN,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_BUCKET: env.S3_BUCKET,
    S3_REGION: env.S3_REGION,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    API_PORT: String(port),
    API_BIND: '127.0.0.1',
    PUBLIC_BASE: `http://127.0.0.1:${port}`,
  }
}

async function health(port, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`)
      if (r.status === 200) return true
    } catch { /* starting */ }
    await sleep(250)
  }
  return false
}

async function startOld() {
  const dir = join(oldRoot, 'cloud/test-s3')
  mkdirSync(dir, { recursive: true })
  const blob = spawnSync('git', ['show', `${LEGACY_COMMIT}:cloud/test-s3/server.mjs`], { cwd: ROOT, encoding: 'utf8' })
  if (blob.status !== 0 || !blob.stdout.startsWith('//')) throw new Error(`git show ${LEGACY_COMMIT} 失败: ${blob.stderr}`)
  writeFileSync(join(dir, 'server.mjs'), blob.stdout)
  symlinkSync(join(ROOT, 'cloud/worker'), join(oldRoot, 'cloud/worker'), 'dir')
  symlinkSync(join(ROOT, 'cloud/lib'), join(oldRoot, 'cloud/lib'), 'dir')
  const p = spawn(process.execPath, [join(dir, 'server.mjs')], { env: childEnv(oldPort), stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(p)
  let log = ''
  p.stdout.on('data', (d) => { log += d })
  p.stderr.on('data', (d) => { log += d })
  if (!(await health(oldPort))) throw new Error(`旧 server 未就绪:\n${log.slice(-800)}`)
}

async function startNew() {
  const p = spawn(process.execPath, [join(ROOT, 'cloud/durable/dev.mjs')], { env: childEnv(newPort), stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(p)
  let log = ''
  p.stdout.on('data', (d) => { log += d })
  p.stderr.on('data', (d) => { log += d })
  if (!(await health(newPort))) throw new Error(`新 dev entry 未就绪:\n${log.slice(-800)}`)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}

async function call(port, path, { ticket, body, method = 'POST' } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(ticket ? { authorization: `Bearer ${ticket}` } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-json */ }
  return { status: r.status, json, text, headers: r.headers }
}

function normalize(value, side) {
  if (Array.isArray(value)) return value.map((v) => normalize(v, side))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'uptime_s') continue
      if ((k === 'etag' || k === 'x-amz-version-id') && typeof v === 'string') { out[k] = '<ETAG>'; continue }
      out[k] = normalize(v, side)
    }
    return out
  }
  if (typeof value === 'string') {
    return value
      .replace(/http:\/\/127\.0\.0\.1:909[67]/g, '<BASE>')
      .replace(new RegExp(`-${side}`, 'g'), '-side')
  }
  return value
}

function diff(expected, actual) {
  const a = JSON.stringify(expected)
  const b = JSON.stringify(actual)
  if (a === b) return ''
  return `old=${a.slice(0, 260)} new=${b.slice(0, 260)}`
}

let oldTicket = ''
let newTicket = ''

async function golden(name, path, opts = {}) {
  const perSide = (side, port, ticket) => {
    const body = opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body).replaceAll('__SIDE__', side))
    const p = path.replaceAll('__SIDE__', side)
    return call(port, p, { ...opts, body, ticket: opts.noTicket === true ? undefined : (opts.badTicket === true ? 'bad.bad.bad' : ticket) })
  }
  const o = await perSide('old', oldPort, oldTicket)
  const n = await perSide('new', newPort, newTicket)
  const on = normalize(o.json ?? o.text, 'old')
  const nn = normalize(n.json ?? n.text, 'new')
  check(`parity:${name}`, o.status === n.status && JSON.stringify(on) === JSON.stringify(nn), `status ${o.status}/${n.status} ${diff(on, nn)}`)
}

async function main() {
  await startOld()
  await startNew()
  oldTicket = await mintTicket({ ...env, DURABLE: `http://127.0.0.1:${oldPort}` }, env.TEST_OID)
  newTicket = await mintTicket({ ...env, DURABLE: `http://127.0.0.1:${newPort}` }, env.TEST_OID)

  check('ticket:old dev mint', oldTicket.split('.').length === 3)
  check('ticket:new dev mint', newTicket.split('.').length === 3)

  const due = Date.now() - 5000
  const stateKey = `state/${RUN}-__SIDE__`
  const claimKey = `${RUN}-claim-__SIDE__`
  const alarmKey = `alarms/${due}-${RUN}-__SIDE__`
  const vfsKey = `vfs/parity/${RUN}-__SIDE__/a.txt`
  const bytesB64 = Buffer.from('parity-hello').toString('base64')
  const sha = (await import('node:crypto')).createHash('sha256').update(Buffer.from('parity-hello')).digest('hex')

  await golden('healthz', '/healthz', { method: 'GET', noTicket: true })
  await golden('state:no-ticket', '/v1/state/get', { body: { key: stateKey }, noTicket: true })
  await golden('state:bad-ticket', '/v1/state/get', { body: { key: stateKey }, badTicket: true })
  await golden('state:get-404', '/v1/state/get', { body: { key: `state/${RUN}-absent-__SIDE__` } })
  await golden('state:put-create', '/v1/state/put-cas', { body: { key: stateKey, body: 'v1', cond: { ifNoneMatch: '*' } } })
  await golden('state:put-conflict', '/v1/state/put-cas', { body: { key: stateKey, body: 'v2', cond: { ifNoneMatch: '*' } } })
  await golden('state:get', '/v1/state/get', { body: { key: stateKey } })
  await golden('state:stale-ifmatch', '/v1/state/put-cas', { body: { key: stateKey, body: 'v3', cond: { ifMatch: 'deadbeef' } } })
  await golden('state:bad-key', '/v1/state/get', { body: { key: 'state/../x' } })
  await golden('state:oversize', '/v1/state/put-cas', { body: { key: `state/${RUN}-big-__SIDE__`, body: 'x'.repeat(300 * 1024) } })
  await golden('claim:create', '/v1/claim', { body: { key: claimKey, holder: 'h1', ttlMs: 60000 } })
  await golden('claim:conflict', '/v1/claim', { body: { key: claimKey, holder: 'h2', ttlMs: 60000 } })
  await golden('alarm:due', '/v1/alarm/due', { body: { now: Date.now() + 1000 } })
  await golden('alarm:put', '/v1/state/put-cas', { body: { key: alarmKey, body: JSON.stringify({ sessionId: `s-${RUN}-__SIDE__`, dueAt: due }), cond: { ifNoneMatch: '*' } } })
  await golden('alarm:claim', '/v1/alarm/claim', { body: { key: `${due}-${RUN}-__SIDE__`, holder: 'h1' } })
  await golden('alarm:claim-again', '/v1/alarm/claim', { body: { key: `${due}-${RUN}-__SIDE__`, holder: 'h1' } })
  await golden('vfs:put', '/v1/vfs/put', { body: { key: vfsKey, bytes_b64: bytesB64, mime: 'text/plain', sha256: sha } })
  await golden('vfs:put-conflict', '/v1/vfs/put', { body: { key: vfsKey, bytes_b64: bytesB64, mime: 'text/plain', if_none_match: true } })
  await golden('vfs:get', '/v1/vfs/get', { body: { key: vfsKey } })
  await golden('vfs:list', '/v1/vfs/list', { body: { prefix: `vfs/parity/${RUN}-__SIDE__/` } })
  await golden('vfs:bad-sha', '/v1/vfs/put', { body: { key: `vfs/parity/${RUN}-__SIDE__/bad.txt`, bytes_b64: bytesB64, sha256: '00'.repeat(32) } })
  await golden('vfs:traversal', '/v1/vfs/get', { body: { key: 'vfs/../x' } })
  await golden('vfs:del', '/v1/vfs/del', { body: { key: vfsKey } })
  await golden('vfs:del-again', '/v1/vfs/del', { body: { key: vfsKey } })
  await golden('artifact:bad-mime', '/v1/artifacts/publish', { body: { bytes_b64: bytesB64, mime: 'text/html' } })
  await golden('artifact:publish', '/v1/artifacts/publish', { body: { bytes_b64: bytesB64, mime: 'text/plain' } })
  await golden('a:404', '/a/nothex', { method: 'GET', noTicket: true })
  await golden('route:404', '/nope', { method: 'GET', noTicket: true })

  // /a/{sha} 按 publish 的 sha 直接比字节（不走 JSON 归一）。
  {
    const o = await fetch(`http://127.0.0.1:${oldPort}/a/${sha}`)
    const n = await fetch(`http://127.0.0.1:${newPort}/a/${sha}`)
    const ob = Buffer.from(await o.arrayBuffer()).toString('utf8')
    const nb = Buffer.from(await n.arrayBuffer()).toString('utf8')
    check('parity:a-get', o.status === n.status && ob === nb, `${o.status}/${n.status} ${ob.slice(0, 40)}/${nb.slice(0, 40)}`)
  }
}

try {
  await main()
} catch (e) {
  check('parity:run', false, String(e?.stack ?? e).slice(0, 800))
} finally {
  for (const p of children) { try { p.kill('SIGTERM') } catch { /* gone */ } }
  await sleep(300)
  try { rmSync(oldRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
}

const failed = results.filter((r) => !r.ok)
const payload = report('mn06-parity', results.map((r) => ({ id: r.name, pass: r.ok })), { commit: process.env.GIT_COMMIT ?? '', ran_at: new Date().toISOString() })
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()} old=${LEGACY_COMMIT} base=${env.BASE}`)
if (failed.length > 0) process.exit(1)
