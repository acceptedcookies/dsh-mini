#!/usr/bin/env node
// token-audit.mjs — 样式裸值审计器（UT-02）
// 扫描 app.less + components/**/*.less + pages/**/*.less，
// 非 token 定义行（不以 `--x:` 开头的自定义属性定义）上的裸字面量 = 违规。
// 用法:
//   node scripts/token-audit.mjs            汇总打印；有残留 exit 1
//   node scripts/token-audit.mjs --json     机器可读 JSON
//   node scripts/token-audit.mjs --baseline out.json   另存基线快照
//   node scripts/token-audit.mjs --diff out.json       与基线对比
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SCAN_DIRS = ['components', 'pages']
const EXTRA_FILES = ['app.less']

// ── 文件级豁免：生成物整文件豁免（T-O-9：审计边界=文件边界）──
const EXEMPT_FILE_RE = /(^|\/)(skin-test\.gen|skin)\.gen\.(wxss|less)$/
// 生成物内允许的自定义属性命名空间（T-O-7 surface 白名单）
const SURFACE_VAR_RE = /^--dsw-surface-[a-z0-9-]+$/

// ── 白名单（合法语义，不计违规）────────────────────────────
const RADIUS_ALLOW = new Set(['0', '0px'])
// 横向 pinned 组件几何：非阶梯成员的冻结字面量（阶梯值 {2,4,6,8,10,12,14,16,20,24,32} 必须走 var）
const GUTTER_PINNED = new Set([0, 1, 3, 5, 7, 9, 18, 22, 26, 36, 44, 56, 64, 72])
const TRACKING_ALLOW = new Set(['normal', '0'])
const WEIGHT_ALLOW = new Set(['normal', 'inherit', 'lighter', 'bolder'])

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/
const PX_RE = /(-?\d+(?:\.\d+)?)px/g

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.less')) out.push(p)
  }
  return out
}

const files = [...EXTRA_FILES.map((f) => join(ROOT, f))]
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d)
  try {
    if (statSync(abs).isDirectory()) files.push(...walk(abs))
  } catch {}
}

function stripComments(line, inBlock) {
  let out = ''
  let i = 0
  while (i < line.length) {
    if (!inBlock && line.startsWith('/*', i)) {
      const end = line.indexOf('*/', i + 2)
      if (end === -1) return { text: out, inBlock: true }
      i = end + 2
      continue
    }
    if (!inBlock && line.startsWith('//', i)) return { text: out, inBlock: false }
    if (inBlock) {
      const end = line.indexOf('*/', i)
      if (end === -1) return { text: out, inBlock: true }
      i = end + 2
      inBlock = false
      continue
    }
    out += line[i++]
  }
  return { text: out, inBlock: false }
}

/** 取声明值部分：'  padding: 0 16px;' → '0 16px' */
function declValue(line, prop) {
  const m = line.match(new RegExp(`(?:^|[{;\\s])${prop}\\s*:\\s*([^;}]+)`))
  return m ? m[1].trim() : null
}

/** 水平分量集合（padding/margin 简写 1~4 值 + 单边 + inline + gap 单列） */
function horizontalPxTokens(prop, value) {
  const toks = value.split(/\s+/).filter(Boolean)
  const pick = (t) => (t.includes('var(') || t.includes('calc(') || t === 'auto' ? null : t.match(PX_RE) ? t : null)
  if (prop === 'gap') {
    return toks.length === 1 ? toks.map(pick).filter(Boolean) : [toks[1]].map(pick).filter(Boolean)
  }
  if (/-(left|right|inline|inline-start|inline-end|column)/.test(prop)) {
    return toks.map(pick).filter(Boolean)
  }
  if (toks.length === 1) return toks.map(pick).filter(Boolean) // 单值=四边
  if (toks.length === 2) return [toks[1]].map(pick).filter(Boolean)
  if (toks.length === 3) return [toks[1]].map(pick).filter(Boolean)
  return [toks[1], toks[3]].map(pick).filter(Boolean)
}

const violations = { color: [], radius: [], fontSize: [], lineHeight: [], tracking: [], weight: [], gutter: [], tokenDef: [], fallback: [] }

// 生成物 token 值表（用于 var() fallback 一致性审计；gen 文件豁免不等于其值不可被引用）
const GEN_FILE = join(ROOT, 'skin.gen.wxss')
const TOKEN_VALUES = {}
try {
  const gen = readFileSync(GEN_FILE, 'utf8')
  for (const m of gen.matchAll(/^\s{2}(--[a-z0-9-]+):\s*(.+);$/gm)) TOKEN_VALUES[m[1]] = m[2].trim()
} catch { /* gen 未生成时跳过 fallback 审计 */ }
const push = (k, file, line, text) => violations[k].push({ file, line, text })

for (const abs of files) {
  const rel = relative(ROOT, abs)
  if (EXEMPT_FILE_RE.test(rel)) continue // 生成物全文件豁免
  const lines = readFileSync(abs, 'utf8').split('\n')
  let inBlock = false
  lines.forEach((raw, idx) => {
    const { text, inBlock: nb } = stripComments(raw, inBlock)
    inBlock = nb
    const line = text.trim()
    if (!line) { return }
    // 手写段禁 `--x:` 定义行（P5-01 后 app.less 仅结构规则）
    if (/^\s*--[\w-]+\s*:/.test(raw)) {
      if (rel === 'app.less' && !SURFACE_VAR_RE.test(raw.trim().split(':')[0].trim())) {
        push('tokenDef', rel, idx + 1, raw.trim())
      }
      return
    }
    const ln = idx + 1

    // 0. var() fallback 一致性：--dsw-* 的兜底字面量必须等于生成值
    for (const m of line.matchAll(/var\((--dsw-[a-z0-9-]+),\s*([^)]+)\)/g)) {
      const token = m[1]
      const fallback = (m[2] ?? '').trim()
      if (TOKEN_VALUES[token] !== undefined && TOKEN_VALUES[token] !== fallback) {
        push('fallback', rel, ln, line)
        break
      }
    }

    // 1. 色彩（mask-image 的 #000 是不透明遮罩实现细节，豁免）
    // box-shadow 是 elevation 复合值（非色彩 token 面）；MS01 维持现值，不纳入色彩审计
    if (COLOR_RE.test(line) && !/var\(/.test(line) && !/mask-image/.test(line) && !/box-shadow/.test(line)) push('color', rel, ln, line)

    // 2. 半径
    for (const prop of ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']) {
      const v = declValue(line, prop)
      if (v && !v.includes('var(')) {
        const bad = v.split(/\s+/).some((t) => !RADIUS_ALLOW.has(t) && (t.includes('px') || t.includes('%')))
        if (bad) push('radius', rel, ln, line)
      }
    }

    // 3. 字号
    const fs = declValue(line, 'font-size')
    if (fs && !fs.includes('var(') && fs !== 'inherit') push('fontSize', rel, ln, line)

    // 4. 行高（px 字面量；unitless 比率放过——属字体族内决策）
    const lh = declValue(line, 'line-height')
    if (lh && /\dpx/.test(lh) && !lh.includes('var(')) push('lineHeight', rel, ln, line)

    // 5. 字距
    const ls = declValue(line, 'letter-spacing')
    if (ls && !ls.includes('var(') && !TRACKING_ALLOW.has(ls)) push('tracking', rel, ln, line)

    // 5b. 字重
    const fw = declValue(line, 'font-weight')
    if (fw && !fw.includes('var(') && !WEIGHT_ALLOW.has(fw)) push('weight', rel, ln, line)

    // 6. 横向边距/间距
    for (const prop of ['padding', 'margin', 'gap', 'padding-left', 'padding-right', 'padding-inline', 'padding-inline-start', 'padding-inline-end', 'margin-left', 'margin-right', 'margin-inline', 'margin-inline-start', 'margin-inline-end', 'column-gap']) {
      const v = declValue(line, prop)
      if (!v || v.includes('var(')) continue
      const toks = horizontalPxTokens(prop, v)
      const bad = toks.some((t) => {
        const m = t.match(PX_RE) // /g 返回全匹配数组：m[0]='7px'
        return m && !GUTTER_PINNED.has(Math.abs(parseFloat(m[0])))
      })
      if (bad) push('gutter', rel, ln, line)
    }
  })
}

const counts = Object.fromEntries(Object.entries(violations).map(([k, v]) => [k, v.length]))
const total = Object.values(counts).reduce((a, b) => a + b, 0)

const args = process.argv.slice(2)
const argOf = (k) => { const i = args.indexOf(k); return i !== -1 ? args[i + 1] : null }

if (args.includes('--json') || argOf('--baseline') || argOf('--diff')) {
  const snap = { generatedAt: new Date().toISOString(), counts, total, violations }
  const b = argOf('--baseline')
  if (b) writeFileSync(b, JSON.stringify(snap, null, 2))
  const d = argOf('--diff')
  if (d) {
    const base = JSON.parse(readFileSync(d, 'utf8'))
    console.log(JSON.stringify({ baseline: base.counts, current: counts, delta: Object.fromEntries(Object.keys(counts).map((k) => [k, counts[k] - (base.counts[k] ?? 0)])) }, null, 2))
  } else {
    console.log(JSON.stringify(snap, null, 2))
  }
  process.exit(total > 0 ? 1 : 0)
}

console.log('┌─ token-audit · 裸值残留 ─────────────────')
for (const [k, list] of Object.entries(violations)) {
  console.log(`│ ${k.padEnd(10)} ${String(list.length).padStart(4)}`)
  const byFile = {}
  for (const v of list) (byFile[v.file] ??= []).push(v)
  for (const [f, vs] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
    console.log(`│   ${f}  ×${vs.length}`)
  }
}
console.log(`└─ total ${total}${total ? '  → exit 1' : '  ✅ clean'}`)
process.exit(total > 0 ? 1 : 0)
