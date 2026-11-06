// L1（Node，无 IDE）：anchors.json schema + 注册/存活双向一致性。
// 证据点：schema 字段完备、disc 动态行字段、注册表↔wxml data-anchor 双向零差。
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const raw = readFileSync(`${ROOT}/scripts/dev-cli/anchors.json`, 'utf8')
const reg = JSON.parse(raw)
check('anchors.json 顶层 schema', reg.$schema === 'dsh-mini.anchors.v1' && typeof reg.anchors === 'object', `schema=${reg.$schema}`)

const anchors = reg.anchors
const entries = Object.entries(anchors)
check('锚点量 ≥80', entries.length >= 80, `n=${entries.length}`)

let bad = []
for (const [name, meta] of entries) {
  if (typeof meta.selector !== 'string' || !meta.selector.length) bad.push(`${name}:selector`)
  if (!meta.selector.includes(`data-anchor="${name}"`)) bad.push(`${name}:selector未含自身锚`)
  if (typeof meta.page !== 'string' || !meta.page.length) bad.push(`${name}:page缺失`)
  if (typeof meta.kind !== 'string' || !meta.kind.length) bad.push(`${name}:kind缺失`)
  if (meta.disc !== undefined && typeof meta.disc !== 'string') bad.push(`${name}:disc类型`)
}
check('每条 {page,selector 含自身锚,kind,disc 合法}', bad.length === 0, bad.slice(0, 5).join(';'))

// 锚名唯一性：JSON.parse 会吞重复键——对原文做键计数才有效
const keyCount = {}
for (const m of raw.matchAll(/"([a-zA-Z][\w.\-]*)":\s*\{/g)) keyCount[m[1]] = (keyCount[m[1]] ?? 0) + 1
const dups = entries.map(([n]) => n).filter((n) => keyCount[n] > 1)
check('锚名唯一性（原文键计数）', dups.length === 0, dups.join(',') || `${entries.length} 键无重复`)

// lint 桥接：真实树 exit 0 且三段全零
const out = execFileSync('node', [`${ROOT}/scripts/dev-cli/lint.mjs`], { encoding: 'utf8' })
check('lint 真实树三段零', /未锚交互 \(0\)/.test(out) && /烂锚 \(0\)/.test(out) && /未注册锚 \(0\)/.test(out))
check('lint 存活率=100%', /存活率: 100\.0%/.test(out), out.match(/存活率: [\d.]+%/)?.[0])

// 动态行锚存在且带 disc
const dyn = entries.filter(([, m]) => m.disc)
check('动态行锚 disc 覆盖 ≥4 类', dyn.length >= 4, dyn.map(([n, m]) => `${n}:${m.disc}`).slice(0, 4).join(' '))

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
