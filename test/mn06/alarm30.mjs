// MN06-T21 —— 同码 sweepTick + 真 30s loop（验收 #5 唯一载体）。
//
// 先留一个可 resume 的 kernel fragment + due alarm，再以 local-sweeper
// --loop --interval-ms 30000 --expect-completed <sid> 跑至少两 tick；
// S3/时钟真，LLM scripted；单 tick/重复消费/超时均非 0。
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, requireEnv, assertMode600, assertLocalEndpoint, report } from './env.mjs'
import { createShadow } from './shadow.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(ROOT, 'package.json'))
const kernel = (() => { const b = require(join(ROOT, 'cloud/functions/sweeper/vendor/kernel.cjs')); return b.kernel ?? b })()
const host = require(join(ROOT, 'cloud/functions/sweeper/vendor/host.cjs'))

const env = loadEnv()
try {
  assertMode600()
  assertLocalEndpoint(env.BASE, 'BASE')
  assertLocalEndpoint(env.DURABLE, 'DURABLE')
  requireEnv(env, ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
} catch (e) {
  console.error(`[alarm30] env: ${e?.message ?? e}`)
  process.exit(3)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}

const shadow = await createShadow(env, env.TEST_OID)
const SID = `mn06-alarm-${Date.now().toString(36)}`
const prov = { context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ioFor(script = {}) {
  return {
    state: shadow.cas,
    llm: async () => {
      script.n = (script.n ?? 0) + 1
      if (script.n === 1 && script.toolFirst) return { text: null, toolCalls: [{ id: 'c1', name: 'file_read', input: { path: '/data/x' } }] }
      return { text: 'done', usage: { inputTokens: 1, outputTokens: 1 } }
    },
    tool: async () => ({ kind: 'inline-text', text: '{"echo":"ok"}', byte_length: 8, provenance: prov }),
  }
}

// 留可恢复 fragment（killAfter:1 + 租约即刻过期），再写 due alarm。
const io = ioFor({ toolFirst: true })
const killed = await host.runPump({ kernel, io, owner: 'self', holder: 'mn06-alarm-seed' }, SID, { input: { role: 'user', content: 'hi' }, killAfter: 1, claimTtlMs: 0 })
const due = Date.now() - 5000
const put = await shadow.raw('state/put-cas', { key: `alarms/${due}-${SID}`, body: JSON.stringify({ sessionId: SID, kind: 'turn-resume', dueAt: due, fence: 'mn06' }), cond: { ifNoneMatch: '*' } })
check('seed:fragment+killed', killed.outcome === 'killed' && put.status === 200, `outcome=${killed.outcome} put=${put.status}`)

const started = Date.now()
const child = spawn(process.execPath, [join(ROOT, 'scripts/local-sweeper.mjs'), '--loop', '--interval-ms', '30000', '--expect-completed', SID, '--timeout-ms', '120000'], {
  env: { ...process.env, BASE: env.BASE, TICKET: shadow.ticket },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', (d) => { out += d })
child.stderr.on('data', (d) => { out += d })
const code = await new Promise((resolve) => {
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } resolve(124) }, 150000)
  child.on('close', (c) => { clearTimeout(timer); resolve(c ?? 1) })
})

const ticks = [...out.matchAll(/tick=(\d+) at=([^\s]+) ran=/g)].map((m) => ({ n: Number(m[1]), at: Date.parse(m[2]) }))
const completedLines = [...out.matchAll(/"sessionId":"([^"]+)","outcome":"completed"/g)].map((m) => m[1]).filter((s) => s === SID)
const interval = ticks.length >= 2 ? ticks[1].at - ticks[0].at : 0
check('loop:exit 0', code === 0, `exit=${code} elapsed=${Date.now() - started}ms`)
check('loop:≥2 tick', ticks.length >= 2, `ticks=${ticks.length}`)
check('loop:间隔 ≥30000ms', interval >= 30000, `interval=${interval}ms`)
check('loop:目标 alarm 恰好 completed 一次', completedLines.length === 1, `completed=${completedLines.length}`)

const dueAfter = await shadow.raw('alarm/due', { now: Date.now() })
check('loop:due alarm 已消费', !(dueAfter.body?.keys ?? []).some((k) => k.includes(SID)), JSON.stringify(dueAfter.body?.keys?.filter((k) => k.includes(SID)) ?? []))

const failed = results.filter((r) => !r.ok)
report('mn06-alarm30', results.map((r) => ({ id: r.name, pass: r.ok })), { ran_at: new Date().toISOString(), sid: SID, ticks: ticks.length, interval_ms: interval })
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()}`)
if (failed.length > 0) process.exit(1)
