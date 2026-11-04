// MN01-T07 生命周期语义：tick 启停 + pending-catchup 标记 + catchUp 幂等。
// Node 侧驱动真 tick.ts（esbuild 打包，wx shim + kernel-loader 在 Node 下
// 会 try-require 分包——存在则可跑真 kernel 扫 alarm；不存在则优雅降级）。
// 用法：node test/mn01/lifecycle.mjs
import './wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent' })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick, localCas } = mod.exports

const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`) }
const PENDING = 'dsh:mini:pending-catchup'

// 1) onHide 语义：stop 落 pending 标记
nanoMiniStopTick()
check('lifecycle:pending-on-hide', __store.get(PENDING) === true, `pending=${__store.get(PENDING)}`)

// 2) kernel-loader 优雅降级（Node 侧 require subpkg 失败→catchUp 空跑不炸）
const ran = await nanoMiniCatchUp()
check('lifecycle:catchup-safe', Array.isArray(ran), `catchUp ran=${JSON.stringify(ran)}（Node 无 wx.require→kernel 不可用时安全空转）`)
check('lifecycle:pending-cleared-or-kept', __store.get(PENDING) === true, `ran 为空时 pending 保持（下次启动再补）`)

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
