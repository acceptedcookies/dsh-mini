// 本地 sweeper 进程——cloud/functions/sweeper 的同构本地解法（MN02 §0.2.7 降级登记面）。
// 同码件：vendor/host.cjs sweepTick + remoteCas 线格式（与 mp local tick 共享 io.state 语义）。
// 差异：云函数经 wx 控制面枚举 byok_keys openid 并自签票据；本地进程用 dev 铸票跑单 oid。
// 用法：TICKET=$(dev-ticket) BASE=https://dsh-mini.haimang.com.cn node scripts/local-sweeper.mjs [--llm-script]
import '../test/mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const BASE = (process.env.BASE ?? 'https://dsh-mini.haimang.com.cn').replace(/\/$/, '')
const TICKET = process.env.TICKET ?? ''
if (!TICKET) { console.error('TICKET env required'); process.exit(2) }

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repo, 'package.json'))
const kernel = (() => { const b = require(join(repo, 'cloud/functions/sweeper/vendor/kernel.cjs')); return b.kernel ?? b })()
const host = require(join(repo, 'cloud/functions/sweeper/vendor/host.cjs'))

const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
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
const cas = createRemoteCas({ baseUrl: BASE, owner: 'self', headers: () => ({ authorization: `Bearer ${TICKET}` }), post })

// io.llm：scripted（durable-alarm 机械面的实验；llm 真链 B-43/G4 另行验证）
const ioFor = () => ({
  state: cas,
  llm: async () => ({ text: 'sweeper-llm-stub', usage: { inputTokens: 1, outputTokens: 1 } }),
  tool: async (name) => ({
    kind: 'error',
    error: { code: 'tool-requires-local-vfs', message: `sweeper-side tool unavailable: ${name}` },
    byte_length: 0, effect_state: 'not-started', retryable: false,
    provenance: { context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' },
  }),
})

const ctx = { kernel, io: ioFor(), owner: 'self', holder: `local-sweeper-${Date.now()}` }
const ran = await host.sweepTick(ctx, { batchLimit: 10 }, ioFor)
console.log(`[local-sweeper] ran=${JSON.stringify(ran)}`)
process.exit(0)
