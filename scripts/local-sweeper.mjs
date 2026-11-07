// 本地 sweeper 进程——cloud/functions/sweeper 的同构本地解法（MN02 §0.2.7 降级登记面）。
// 同码件：vendor/host.cjs sweepTick + remoteCas 线格式（与 mp local tick 共享 io.state 语义）。
// 差异：云函数经 wx 控制面枚举 byok_keys openid 并自签票据；本地进程用 dev 铸票跑单 oid。
//
// 用法：
//   TICKET=... BASE=http://127.0.0.1:9095 node scripts/local-sweeper.mjs
//   ... --loop --interval-ms 30000 --expect-completed <sid> [--timeout-ms 120000]
// 失败/超时/重复消费 → 非 0；单 tick 不再静默 exit 0。
import '../test/mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repo, 'package.json'))
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')

export async function createCas(env) {
  const kernel = (() => { const b = require(join(repo, 'cloud/functions/sweeper/vendor/kernel.cjs')); return b.kernel ?? b })()
  const host = require(join(repo, 'cloud/functions/sweeper/vendor/host.cjs'))
  const entry = join(mkdtempSync(join(tmpdir(), 'sweep-')), 'entry.ts')
  writeFileSync(entry, `
import { createRemoteCas } from '${repo}/services/state/remote-cas'
export { createRemoteCas }
`)
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  const { createRemoteCas } = mod.exports
  const post = async (url, headers, body) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const cas = createRemoteCas({ baseUrl: env.BASE, owner: 'self', headers: () => ({ authorization: `Bearer ${env.TICKET}` }), post })
  return { kernel, host, cas }
}

/** io.llm：scripted（durable-alarm 机械面的实验；llm 真链另行验证）。
 *  S3/时钟/状态全真；只有模型输出是脚本替身（T-O-8 #5 口径）。 */
export function ioFor(cas) {
  return () => ({
    state: cas,
    llm: async () => ({ text: 'sweeper-llm-stub', usage: { inputTokens: 1, outputTokens: 1 } }),
    tool: async (name) => ({
      kind: 'error',
      error: { code: 'tool-requires-local-vfs', message: `sweeper-side tool unavailable: ${name}` },
      byte_length: 0, effect_state: 'not-started', retryable: false,
      provenance: { context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' },
    }),
  })
}

export async function runSweep({ kernel, host, cas, holder, batchLimit = 10 }) {
  const mk = ioFor(cas)
  const ctx = { kernel, io: mk(), owner: 'self', holder }
  return host.sweepTick(ctx, { batchLimit }, mk)
}

function parseArgs(argv) {
  const out = { loop: false, intervalMs: 30000, timeoutMs: 120000, expect: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--loop') out.loop = true
    else if (a === '--interval-ms') out.intervalMs = Number(argv[++i] ?? out.intervalMs)
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i] ?? out.timeoutMs)
    else if (a === '--expect-completed') out.expect = argv[++i] ?? ''
    else if (a === '--llm-script') out.script = true
  }
  if (!Number.isFinite(out.intervalMs) || out.intervalMs <= 0) out.intervalMs = 30000
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) out.timeoutMs = 120000
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const BASE = (process.env.BASE ?? 'https://dsh-mini.haimang.com.cn').replace(/\/$/, '')
  const TICKET = process.env.TICKET ?? ''
  if (!TICKET) { console.error('TICKET env required'); process.exit(2) }
  const { kernel, host, cas } = await createCas({ BASE, TICKET })

  if (!args.loop) {
    const ran = await runSweep({ kernel, host, cas, holder: `local-sweeper-${Date.now()}` })
    console.log(`[local-sweeper] ran=${JSON.stringify(ran)}`)
    if (args.expect !== '' && !ran.some((r) => r.sessionId === args.expect)) {
      console.error(`[local-sweeper] expect-completed ${args.expect} 未完成`)
      process.exit(1)
    }
    process.exit(0)
  }

  const started = Date.now()
  const seen = new Map()
  let ticks = 0
  let completed = 0
  for (;;) {
    ticks += 1
    const at = new Date().toISOString()
    let ran = []
    try {
      ran = await runSweep({ kernel, host, cas, holder: `local-sweeper-${Date.now()}` })
    } catch (e) {
      console.error(`[local-sweeper] tick=${ticks} error=${String(e?.message ?? e)}`)
      process.exit(1)
    }
    console.log(`[local-sweeper] tick=${ticks} at=${at} ran=${JSON.stringify(ran)}`)
    for (const r of ran) {
      if (args.expect === '' || r.sessionId !== args.expect || r.outcome !== 'completed') continue
      completed += 1
      const n = (seen.get(r.sessionId) ?? 0) + 1
      seen.set(r.sessionId, n)
      if (n > 1) {
        console.error(`[local-sweeper] alarm ${r.sessionId} 被重复消费（completed=${n}）`)
        process.exit(1)
      }
    }
    if (ticks >= 2 && (args.expect === '' || completed >= 1)) {
      console.log(`[local-sweeper] done ticks=${ticks} elapsed_ms=${Date.now() - started} completed=${completed}`)
      process.exit(0)
    }
    if (Date.now() - started + args.intervalMs > args.timeoutMs) {
      console.error(`[local-sweeper] timeout ticks=${ticks} elapsed_ms=${Date.now() - started} expect=${args.expect} completed=${completed}`)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, args.intervalMs))
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
