// MN06-T02 —— 入口隔离：生产入口与 core import 闭包无 admin 面。
//
// 静态：server.mjs + core.mjs 传递 import 闭包不得出现 /dev/ 或 ADMIN_TOKEN；
//       server.mjs 不得 import dev.mjs；dev.mjs 必须挂 /dev/ticket 与 /dev/stats。
// 启动：缺 TICKET_SECRET / ADMIN_TOKEN 时对应入口 must fail-closed；
//       生产入口带齐全凭证启动后 /dev/ticket 必须是 404。
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { report, isMain } from './env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const serverPath = join(ROOT, 'cloud/durable/server.mjs')
const corePath = join(ROOT, 'cloud/durable/core.mjs')
const devPath = join(ROOT, 'cloud/durable/dev.mjs')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}

function importsOf(file) {
  const text = readFileSync(file, 'utf8')
  const out = []
  for (const m of text.matchAll(/(?:import\s+(?:[^'"]*?\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1])
  return { text, out }
}

function closure(entry) {
  const seen = new Set()
  const files = []
  const stack = [entry]
  while (stack.length > 0) {
    const file = resolve(stack.pop())
    if (seen.has(file) || !existsSync(file) || !statSync(file).isFile()) continue
    seen.add(file)
    files.push(file)
    const { out } = importsOf(file)
    for (const spec of out) {
      if (spec.startsWith('node:') || spec.startsWith('.')) {
        if (spec.startsWith('.')) stack.push(join(dirname(file), spec))
      }
    }
  }
  return files
}

// ── 静态 ──────────────────────────────────────────────────────────────
try {
  const files = closure(serverPath)
  const adminHits = []
  const devHits = []
  for (const f of files) {
    const { text } = importsOf(f)
    if (text.includes('ADMIN_TOKEN')) adminHits.push(f.replace(ROOT + '/', ''))
    if (/\/dev\//.test(text)) devHits.push(f.replace(ROOT + '/', ''))
  }
  check('static:server import closure 无 ADMIN_TOKEN', adminHits.length === 0, adminHits.join(','))
  check('static:server import closure 无 /dev/ 路由', devHits.length === 0, devHits.join(','))
  check('static:server 不 import dev.mjs', !importsOf(serverPath).out.some((s) => s.includes('dev.mjs')))
  const devText = readFileSync(devPath, 'utf8')
  check('static:dev 挂 /dev/ticket + /dev/stats + ADMIN_TOKEN',
    devText.includes('/dev/ticket') && devText.includes('/dev/stats') && devText.includes('ADMIN_TOKEN'))
  check('static:core 不存在于 dev 闭包之外的第二份合同', closure(corePath).every((f) => !f.endsWith('server.mjs')))
} catch (e) {
  check('static:scan', false, String(e?.message ?? e))
}

// ── 启动 ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const children = []
function run(script, env) {
  const p = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  p.log = () => out
  children.push(p)
  return p
}
async function waitHealth(port, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200) return true } catch { /* starting */ }
    await sleep(200)
  }
  return false
}
async function waitExit(p, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (p.exitCode !== null) return p.exitCode
    await sleep(100)
  }
  return null
}

const baseEnv = {
  TICKET_SECRET: 'entry-isolation-secret',
  S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_BUCKET: 'entry-isolation-bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'entry-isolation-key',
  S3_SECRET_ACCESS_KEY: 'entry-isolation-secret-key',
  API_BIND: '127.0.0.1',
  PUBLIC_BASE: 'http://127.0.0.1:9198',
}

try {
  const missing = await waitExit(run(serverPath, { ...baseEnv, TICKET_SECRET: '', API_PORT: '9198' }))
  check('startup:server 缺 TICKET_SECRET 非零退出', missing !== null && missing !== 0, `exit=${missing}`)

  const p = run(serverPath, { ...baseEnv, API_PORT: '9198' })
  const up = await waitHealth(9198)
  check('startup:server 无 ADMIN_TOKEN 仍可启动', up, up ? '' : p.log().slice(-400))
  if (up) {
    const r = await fetch('http://127.0.0.1:9198/dev/ticket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    check('startup:生产入口 /dev/ticket → 404', r.status === 404, `status=${r.status}`)
  }
  try { p.kill('SIGTERM') } catch { /* gone */ }

  const devMissing = await waitExit(run(devPath, { ...baseEnv, ADMIN_TOKEN: '', API_PORT: '9199', PUBLIC_BASE: 'http://127.0.0.1:9199' }))
  check('startup:dev 缺 ADMIN_TOKEN 非零退出', devMissing !== null && devMissing !== 0, `exit=${devMissing}`)

  const d = run(devPath, { ...baseEnv, ADMIN_TOKEN: 'entry-isolation-admin', API_PORT: '9199', PUBLIC_BASE: 'http://127.0.0.1:9199' })
  const devUp = await waitHealth(9199)
  check('startup:dev 带 ADMIN_TOKEN 可启动', devUp, devUp ? '' : d.log().slice(-400))
  if (devUp) {
    const no = await fetch('http://127.0.0.1:9199/dev/ticket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    check('startup:dev /dev/ticket 无 token → 403', no.status === 403, `status=${no.status}`)
    const yes = await fetch('http://127.0.0.1:9199/dev/ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'entry-isolation-admin' },
      body: JSON.stringify({ oid: 'entry-isolation-oid', ttl_s: 60 }),
    })
    check('startup:dev /dev/ticket 有 token → 200', yes.status === 200, `status=${yes.status}`)
    const stats = await fetch('http://127.0.0.1:9199/dev/stats', { headers: { 'x-admin-token': 'entry-isolation-admin' } })
    check('startup:dev /dev/stats 路由存在（非 404）', stats.status !== 404, `status=${stats.status}`)
  }
  try { d.kill('SIGTERM') } catch { /* gone */ }
} catch (e) {
  check('startup:run', false, String(e?.message ?? e))
} finally {
  for (const p of children) { try { p.kill('SIGTERM') } catch { /* gone */ } }
}

const failed = results.filter((r) => !r.ok)
report('mn06-entry-isolation', results.map((r) => ({ id: r.name, pass: r.ok })), { ran_at: new Date().toISOString() })
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()}`)
if (failed.length > 0) process.exit(1)
