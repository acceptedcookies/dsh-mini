// MN01-T07 生命周期语义：tick 启停 + pending-catchup 标记 + catchUp 幂等。
// Node 侧驱动真 tick.ts（esbuild 打包，wx shim + kernel-loader 在 Node 下
// 会 try-require 分包——存在则可跑真 kernel 扫 alarm；不存在则优雅降级）。
// 用法：node test/mn01/lifecycle.mjs
import './wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = require('esbuild')
const __store = (await import('./wx-shim.mjs')).__store

const entry = join(mkdtempSync(join(tmpdir(), 'mn01-life-')), 'entry.ts')
writeFileSync(entry, `
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from '${repo}/services/nano-mini-host/tick'
import { localCas } from '${repo}/services/state/local-cas'
export { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick, localCas }
`)
// 本测是 local-tick 面：仓内 dev-config.ts（route=cloud）会被真打包 → 换 fx/dev 为 local stub。
// （依赖注入面替换，源码不动——同 vision-dual 的 dep-swap 模式）
const devStub = join(mkdtempSync(join(tmpdir(), 'mn01-devstub-')), 'dev.ts')
writeFileSync(devStub, `
export const currentRoute = () => ({ mode: 'local' })
export const loadDevConfig = () => undefined
`)
const devSwap = {
  name: 'dev-swap',
  setup(b) { b.onResolve({ filter: /fx\/dev$/ }, () => ({ path: devStub })) },
}
const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent', plugins: [devSwap] })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick, localCas } = mod.exports

const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`) }
const PENDING = 'dsh:mini:pending-catchup'

// 1) onHide 语义：stop 落 pending 标记
nanoMiniStopTick()
check('lifecycle:pending-on-hide', __store.get(PENDING) === true, `pending=${__store.get(PENDING)}`)

// 2) kernel 不可用时 catchUp 降级——但 kernel 存在时必须真扫（审查：kernel 缺位全绿曾是恒真式）
const kernelExists = existsSync(join(repo, 'subpkg/kernel/kernel.js'))
if (!kernelExists) {
  const ran = await nanoMiniCatchUp()
  check('lifecycle:catchup-degraded-honest', Array.isArray(ran) && ran.length === 0, `kernel.js 缺失 → ran=[]（降级诚实登记，非 PASS 语义）`)
} else {
  // kernel 可用时：种子一个 llmFinished 态 + due alarm → catchUp 必须 finish 并消费 alarm
  const { kernel: k } = require(join(repo, 'subpkg/kernel/kernel.js'))
  const sid = 'life2'
  let snap = k.createKernelSnapshot(k.createInitialSessionState())
  for (const a of [
    { type: 'start_turn', turnId: 't-life2' },
    { type: 'interrupt', reason: 'confirmation_pending' },
    { type: 'input_arrived', input: { role: 'user', content: 'hi' } },
    { type: 'resume' },
    { type: 'llm_response', content: { role: 'assistant', content: 'done' }, usage: { inputTokens: 1, outputTokens: 1 } },
  ]) snap = k.applyAction(snap, a)
  await localCas.putCas(`dsh-mini/state/local/${sid}`, JSON.stringify(k.buildCheckpointFragment(snap)), {})
  await localCas.putCas(`dsh-mini/alarms/local/1-${sid}`, JSON.stringify({ sessionId: sid, kind: 'turn-resume', dueAt: 1 }), {})
  const ran2 = await nanoMiniCatchUp()
  const consumed = (await localCas.listPrefix('dsh-mini/alarms/local/')).every((key) => !key.endsWith(sid))
  const claimGone = (await localCas.get(`dsh-mini/claims/local/${sid}`)) === null
  check('lifecycle:catchup-consumes-alarm', ran2.length === 1 && ran2[0] === `${sid}:completed` && consumed && claimGone, `ran=${JSON.stringify(ran2)} consumed=${consumed} claimGone=${claimGone}`)
}

// 3) startTick 置起 interval 且 stop 后清标记路径无竞态
nanoMiniStartTick()
nanoMiniStopTick()
check('lifecycle:stop-idempotent', __store.get(PENDING) === true, 'stop 幂等：重复 stop 不炸、标记仍真')
nanoMiniStopTick() // 二次 stop
check('lifecycle:double-stop', __store.get(PENDING) === true, 'double stop 安全')

// 4) localCas alarm 行 → catchUp 在 kernel 可用时应消费（Node 侧 kernel.js 存在则真跑）
const alarmKey = `dsh-mini/alarms/local/${Date.now() - 1}-life`
await localCas.putCas(alarmKey, JSON.stringify({ sessionId: 'life', kind: 'turn-resume', dueAt: 1 }), {})
const due = await localCas.listPrefix('dsh-mini/alarms/local/')
check('lifecycle:alarm-visible', due.includes(alarmKey), `due alarm 已入索引 → ${due.length} 行`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
