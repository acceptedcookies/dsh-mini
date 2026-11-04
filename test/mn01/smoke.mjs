// MN01-T06 smoke：kernel 分包加载 + T2 导出可调用 + zod 金丝雀 + sha256 shim 金丝雀
// + start-turn → llm_call。四要素断言，非 "loaded=true" 级假绿。
// 用法：node test/mn01/smoke.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'package.json'))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

const bundle = require(join(repo, 'subpkg/kernel/kernel.js'))
const k = bundle.kernel ?? bundle

// 1) T2 导出具名可调用（形状由 scripts/build-kernel.mjs entry 固化）
for (const fn of ['createInitialSessionState', 'createKernelSnapshot', 'applyAction', 'scheduleNextStep', 'buildCheckpointFragment', 'restoreFromFragment', 'sha256Prefixed']) {
  check(`export:${fn}`, typeof k[fn] === 'function', `typeof=${typeof k[fn]}`)
}

// 2) zod 金丝雀：fragment round-trip 必经 schema.parse；坏 fragment 必抛
const snap = k.createKernelSnapshot(k.createInitialSessionState())
const frag = k.buildCheckpointFragment(snap)
const back = k.restoreFromFragment(frag)
check('zod:fragment-roundtrip', back !== undefined && back.session !== undefined, `keys=${Object.keys(frag).join(',')}`)
let threw = false
try { k.restoreFromFragment({ garbage: true }) } catch { threw = true }
check('zod:reject-bad-fragment', threw, 'restoreFromFragment({garbage:true}) threw')

// 3) shim 金丝雀：sha256Prefixed 走 crypto.subtle（Node 原生或 mp shim——结果须一致）
const h = await k.sha256Prefixed('mn01')
check('shim:sha256Prefixed', typeof h === 'string' && h.length > 0, `→ ${String(h).slice(0, 24)}`)

// 4) 决策闸：start-turn 状态 → llm_call
const snap2 = k.applyAction(back, { type: 'start_turn', turnId: 't-smoke' })
const d = k.scheduleNextStep(snap2, {
  hasMoreToolCalls: false, compactRequired: false, cancelRequested: false,
  timeoutReached: false, llmFinished: false,
})
check('schedule:llm_call', d.kind === 'llm_call', `kind=${d.kind}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length === 0 ? 0 : 1)
