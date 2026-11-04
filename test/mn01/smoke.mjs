// MN01-T06 smoke：kernel 分包加载 + T2 导出可调用 + zod 金丝雀 + sha256 shim 金丝雀
// + start-turn → llm_call。四要素断言，非 "loaded=true" 级假绿。
// 用法：node test/mn01/smoke.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'package.json'))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

const bundle = require(join(repo, 'subpkg/kernel/kernel.js'))
const k = bundle.kernel // 严格解引用——`?? bundle` 兜底会让 T1 平铺形状也全绿（审查 P1）
check('shape:T2-namespaced', k !== undefined && typeof k === 'object', `bundle.kernel ${k === undefined ? '缺失' : '存在'}`)

// 1) T2 导出具名可调用（形状由 scripts/build-kernel.mjs entry 固化）
for (const fn of ['createInitialSessionState', 'createKernelSnapshot', 'applyAction', 'scheduleNextStep', 'buildCheckpointFragment', 'restoreFromFragment', 'sha256Prefixed']) {
  check(`export:${fn}`, typeof k[fn] === 'function', `typeof=${typeof k[fn]}`)
}

// 1.5) jitless banner 字节断言（Node 无法复现 mp JSC eval 崩——只能断言产物带 banner，审查 P1）
const bytes = readFileSync(join(repo, 'subpkg/kernel/kernel.js'), 'utf8')
check('banner:jitless-zod', bytes.includes('__zod_globalConfig') && bytes.includes('jitless'), '产物含 __zod_globalConfig jitless 注入')

// 2) zod 金丝雀：fragment round-trip 必经 schema.parse；坏 fragment 必抛
const snap = k.createKernelSnapshot(k.createInitialSessionState())
const frag = k.buildCheckpointFragment(snap)
const back = k.restoreFromFragment(frag)
check('zod:fragment-roundtrip', back !== undefined && back.session !== undefined, `keys=${Object.keys(frag).join(',')}`)
let threw = false
try { k.restoreFromFragment({ garbage: true }) } catch { threw = true }
check('zod:reject-bad-fragment', threw, 'restoreFromFragment({garbage:true}) threw（走版本闸——同 NEG）')
// 真 zod schema 拒绝面：version 正确但 body 非法 → 过版本闸后 parse 必抛（审查 P1）
let threw2 = false
try { k.restoreFromFragment({ ...frag, session: 42 }) } catch { threw2 = true }
check('zod:reject-schema-violation', threw2, 'version 正确+session=42 → schema.parse threw')

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
