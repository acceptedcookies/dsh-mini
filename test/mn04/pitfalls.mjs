// L1（Node）：pitfalls.json schema + matchPitfall 命中/未命中 + wrapError 前缀 + 过宽正则反误报。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { matchPitfall, wrapError, loadPitfalls } = await import(`${ROOT}/scripts/dev-cli/lib/pitfalls.mjs`)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const reg = JSON.parse(readFileSync(`${ROOT}/scripts/dev-cli/pitfalls.json`, 'utf8'))
check('pitfalls.json schema + 种子 ≥8', Array.isArray(reg.pitfalls) && reg.pitfalls.length >= 8, `n=${reg.pitfalls?.length}`)

let bad = []
for (const p of reg.pitfalls) {
  if (!/^PITFALL-\d+$/.test(p.id)) bad.push(`${p.id}:id`)
  if (typeof p.symptom !== 'string' || !p.symptom.length) bad.push(`${p.id}:symptom`)
  try { new RegExp(p.symptom) } catch { bad.push(`${p.id}:symptom非法正则`) }
  if (!p.fix && !p.ownerAction) bad.push(`${p.id}:fix/ownerAction 双缺`)
}
check('每坑 {id 格式, symptom 合法正则, fix|ownerAction 有一}', bad.length === 0, bad.join(';'))

// 命中：已知 symptom（任一真实条目自证）
const p0 = reg.pitfalls[0]
const hit = matchPitfall(`boom ${p0.symptom.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`)}`, p0.where ? `${p0.where}-ctx` : 'x')
check('matchPitfall 已知 symptom 命中', hit?.id === p0.id, `${p0.id}`)

// 未命中：无关消息
check('matchPitfall 无关消息不命中', matchPitfall('totally unrelated xyzzy-qq-999', 'anywhere') === undefined)

// 过宽正则反误报闸：每条 symptom 不得在无关消息上命中（防 .* / tap 裸词类误报）
let fp = []
for (const p of reg.pitfalls) {
  try {
    if (new RegExp(p.symptom, 'i').test('all systems nominal; user clicked button happily')) fp.push(p.id)
  } catch { fp.push(`${p.id}:exec`) }
}
check('symptom 对无关消息零误报', fp.length === 0, fp.join(';'))

// wrapError 前缀契约
const w = wrapError(new Error(`boom ${p0.symptom.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`)}`), p0.where ?? '')
check('wrapError → [PITFALL-n] 前缀', new RegExp(`^\\[${p0.id}\\]`).test(w.message) && w.pitfall?.id === p0.id)
check('wrapError 未命中原样返回', wrapError(new Error('zzz-no-match-31415'), 'x').pitfall === undefined)

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
