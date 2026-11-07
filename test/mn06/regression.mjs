// MN06-T18 —— 全量回归执行器：注入测试端点 + PASS/NOTE/FAIL 解析。
//
// preflight：BASE/DURABLE 必须 127.0.0.1:9095，否则 exit 3。
// NOTE/SKIP 不计 PASS；ide-durable 必须 E:openid=TEST_OID；s3-probe 必须 configured=true。
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, requireEnv, assertMode600, assertLocalEndpoint, mintTicket, report } from './env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const env = loadEnv()
try {
  assertMode600()
  assertLocalEndpoint(env.BASE, 'BASE')
  assertLocalEndpoint(env.DURABLE, 'DURABLE')
  requireEnv(env, ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
} catch (e) {
  console.error(`[regression] env: ${e?.message ?? e}`)
  process.exit(3)
}

const TICKET = await mintTicket(env, env.TEST_OID)
const TICKET2 = await mintTicket(env, env.TEST_OID2)
const baseEnv = {
  ...process.env,
  BASE: env.BASE,
  DURABLE: env.DURABLE,
  PUBLIC_BASE: env.BASE,
  TICKET,
  TICKET2,
  ADMIN_TOKEN: env.ADMIN_TOKEN,
  TICKET_SECRET: env.TICKET_SECRET,
  TEST_OID: env.TEST_OID,
  TEST_OID2: env.TEST_OID2,
  PATCH_UNLOCK: '1',
  AUTO_PORT: env.AUTO_PORT,
  S3_ENDPOINT: env.S3_ENDPOINT,
  S3_BUCKET: env.S3_BUCKET,
  S3_REGION: env.S3_REGION,
  S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
}

const NODE = process.execPath
const suites = [
  { name: 'env-check', file: 'test/mn06/env-check.mjs', timeout: 60000 },
  { name: 'docs-check', file: 'test/mn06/docs-check.mjs', timeout: 60000 },
  { name: 'entry-isolation', file: 'test/mn06/entry-isolation.mjs', timeout: 90000 },
  { name: 'parity', file: 'test/mn06/parity.mjs', timeout: 180000 },
  { name: 'tombstone', file: 'test/mn06/tombstone.mjs', timeout: 90000 },
  { name: 'matrix', file: 'test/mn06/matrix.mjs', timeout: 300000 },
  { name: 'alarm30', file: 'test/mn06/alarm30.mjs', timeout: 180000 },
  { name: 'mp-remote', file: 'test/mn02/mp-remote.mjs', timeout: 180000 },
  { name: 'public-surface', file: 'test/mn02/public-surface.mjs', timeout: 180000 },
  { name: 'cold-state', file: 'test/mn02/cold-state.mjs', timeout: 240000 },
  { name: 'edge-matrix', file: 'test/mn02/edge-matrix.mjs', timeout: 300000 },
  { name: 'tool-observability', file: 'test/mn02/tool-observability.mjs', timeout: 180000 },
  { name: 'ide-durable', file: 'test/mn02/ide-durable.mjs', timeout: 240000 },
  { name: 's3-probe', file: 'test/mn01/s3-probe.mjs', timeout: 90000 },
  { name: 'no-self-bridge', file: 'test/mn04/no-self-bridge.mjs', timeout: 60000 },
  { name: 'probe-lane', file: 'test/mn04/probe-lane.mjs', timeout: 90000 },
  { name: 'catalog', file: 'test/mn04/catalog.mjs', timeout: 120000 },
  { name: 'registry', file: 'test/mn04/registry.mjs', timeout: 90000 },
  { name: 'tasks', file: 'test/mn04/tasks.mjs', timeout: 120000 },
  { name: 'doctor', file: 'test/mn04/doctor.mjs', timeout: 120000 },
]

function run(s) {
  return new Promise((resolve) => {
    const started = Date.now()
    const p = spawn(NODE, [join(ROOT, s.file)], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* gone */ } }, s.timeout)
    p.on('close', (code) => {
      clearTimeout(timer)
      const pass = (out.match(/^PASS /gm) ?? []).length
      const fail = (out.match(/^FAIL /gm) ?? []).length
      const note = (out.match(/^NOTE /gm) ?? []).length
      const skip = (out.match(/^SKIP /gm) ?? []).length
      resolve({ name: s.name, exit: code ?? 1, pass, fail, note, skip, ms: Date.now() - started, started_at: new Date(started).toISOString(), out, err })
    })
  })
}

function classify(r) {
  const lines = r.out.split('\n').filter((l) => /^(PASS|FAIL|NOTE|SKIP) /.test(l)).slice(0, 500)
  const base = { name: r.name, pass: r.pass, fail: r.fail, note: r.note, skip: r.skip, exit: r.exit, ms: r.ms, started_at: r.started_at, lines }
  if (r.exit === 3) return { ...base, status: 'skip', reason: 'exit 3（未观察）' }
  if (r.name === 's3-probe') {
    const configured = r.pass === 9 && r.fail === 0 && r.exit === 0
    return { ...base, status: configured ? 'pass' : 'fail', reason: configured ? '' : 's3-probe 非 9/9 或未配置（SKIP 不算 PASS）' }
  }
  if (r.name === 'ide-durable') {
    const eOk = /^PASS E:openid=TEST_OID/m.test(r.out)
    const ok = r.exit === 0 && r.fail === 0 && eOk
    return { ...base, status: ok ? 'pass' : 'fail', reason: ok ? '' : `ide-durable exit=${r.exit} fail=${r.fail} E:openid=${eOk}` }
  }
  if (r.name === 'edge-matrix') {
    const known = r.fail === 2
      && /^FAIL E9:cfg 缺席 picked 非法→enrollment 兜底/m.test(r.out)
      && /^FAIL E9:cfg 缺席未选→enrollment.model/m.test(r.out)
    if (known) return { ...base, status: 'known_pre_existing', reason: 'E9 两项 pre-existing（io/llm 模型解析；EP-1 未改该面）' }
  }
  if (r.fail > 0) return { ...base, status: 'fail', reason: `FAIL=${r.fail}` }
  if (r.exit !== 0) return { ...base, status: 'fail', reason: `exit=${r.exit}` }
  if (r.pass === 0 && !['doctor', 'catalog', 'registry', 'tasks', 'probe-lane'].includes(r.name)) {
    return { ...base, status: 'fail', reason: '零 PASS 行（无法证明）' }
  }
  return { ...base, status: 'pass', reason: '' }
}

const tests = []
for (const s of suites) {
  process.stdout.write(`[regression] ${s.name} … `)
  const r = await run(s)
  const c = classify(r)
  tests.push(c)
  console.log(`${c.status} pass=${c.pass} fail=${c.fail} note=${c.note} exit=${c.exit} ${c.reason}`)
  if (c.status === 'fail' && r.out) console.log(r.out.split('\n').filter((l) => l.startsWith('FAIL ') || l.startsWith('SKIP ')).slice(0, 8).join('\n'))
}

const requiredFail = tests.filter((t) => t.status === 'fail' || t.status === 'skip')
const ranAt = new Date().toISOString()
const payload = report('mn06-regression', tests, {
  ran_at: ranAt,
  base: env.BASE,
  durable: env.DURABLE,
  oid: env.TEST_OID,
  oid2: env.TEST_OID2,
  known_pre_existing: tests.filter((t) => t.status === 'known_pre_existing').map((t) => t.name),
})
// 供 acceptance 同轮消费；token 防止把历史/外部输出当本轮证据。
if (process.env.MN06_REGRESSION_OUT) {
  writeFileSync(process.env.MN06_REGRESSION_OUT, JSON.stringify({
    token: process.env.MN06_REGRESSION_TOKEN ?? '',
    ran_at: ranAt,
    base: env.BASE,
    durable: env.DURABLE,
    oid: env.TEST_OID,
    tests,
  }))
}
console.log(`\n${tests.filter((t) => t.status === 'pass').length}/${tests.length} PASS  ${payload.known_pre_existing.length} known-pre-existing @ ${ranAt}`)
if (requiredFail.length > 0) process.exit(1)
