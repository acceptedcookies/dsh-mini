#!/usr/bin/env node
/**
 * skin-equiv-check.mjs — MS01 resolution-diff 主判据（T-O-11 / MS01-T13）
 *
 * 两个模式：
 *   --baseline        迁移前有效值快照（P0-01）。已存在默认拒绝覆写，--force 显式重建。
 *   --check [--phase p4|p6]
 *                     P6 全量对照：逐消费点 file|selector|prop 粒度对账（行号漂移不影响身份）。
 *                     P4 静态臂：只对 vocab token defaults vs 基线 token 值。
 *
 * 设计纪律：
 *   - 旧值集只能来自 P0 迁移前快照；baseline 与 pin 双文件交叉校验，防迁移后重跑自绿。
 *   - 判具不自证：`--self-test` 篡改 1 个已知基线键 → 必须报 diff 非空。
 *   - 计划内差异（T-O-8 词表收口）显式建模为 intended-delta 规则，不允许静默豁免；
 *     其余任何 diff = exit 1。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { acquireGate } from './gate-lock.mjs'

const ROOT = new URL('..', import.meta.url).pathname
// 门互斥：读 skin.gen.wxss/tracked less，须与 node-checks 的 plant 窗口串行。
acquireGate()
const BASELINE_FILE = join(ROOT, '.anote/ms01-baseline/resolved-values.json')
const PIN_FILE = join(ROOT, '.anote/ms01-baseline/baseline.pin.json')

// ── 词表分区：17 derived legacy 别名（T-O-B6 / 附录 A） ───────────────────
const DERIVED_KEYS = new Set([
  '--bg', '--bg-elevated', '--bg-muted', '--text', '--text-secondary', '--text-tertiary', '--border',
  '--accent', '--accent-soft', '--danger', '--success', '--warn',
  '--user-bubble', '--user-text', '--assistant-bubble', '--shadow', '--radius',
])

// ── T-O-8 计划内差异：旧悬空/旧名 var → 新词表正解 ────────────────────────
const INTENDED_RETARGET = new Map([
  ['--dsw-alias-warning-primary', '--dsw-alias-state-warn-primary'],
  ['--dsw-alias-positive-primary', '--dsw-alias-state-success-primary'],
  ['--dsw-shadow-lv3', '--dsw-elevation-prominent'],
])
// T-O-8 新增键：旧兜底链→新 token，只允许「精确等于新键在该 mode 的值」
const NEW_TOKEN_KEYS = new Set(['--dsw-alias-markdown-code-text', '--dsw-alias-bg-mask-3'])

function expectedIntendedValue(refName, mode, vocab, defs) {
  const target = INTENDED_RETARGET.get(refName) ?? (NEW_TOKEN_KEYS.has(refName) ? refName : undefined)
  if (target === undefined) return undefined
  const entry = vocab.tokens[target]
  if (entry === undefined) return null
  return resolveValue(entry[mode], mode, defs).value
}

// ── less 扫描 ────────────────────────────────────────────────────────────
function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const chunk = end === -1 ? text.slice(i) : text.slice(i, end + 2)
      out += chunk.replace(/[^\n]/g, ' ')
      i = end === -1 ? text.length : end + 2
    } else if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i)
      const end = nl === -1 ? text.length : nl
      out += ' '.repeat(end - i)
      i = end
    } else {
      out += text[i]
      i += 1
    }
  }
  return out
}

function walkLess(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkLess(p, out)
    else if (e.name.endsWith('.less')) out.push(p)
  }
  return out
}

function hasTopSemicolon(value) {
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ';' && depth === 0) return true
  }
  return false
}

/** 解析 less 声明 → [{file,line,selector,prop,value}]（行号=声明起始行）。 */
function scanLessDecls(file) {
  const text = stripComments(readFileSync(file, 'utf8'))
  const lines = text.split('\n')
  const stack = []
  const decls = []
  let i = 0
  while (i < lines.length) {
    const rawLine = lines[i]
    const line = rawLine.trim()
    if (line.length === 0) { i += 1; continue }
    if (line.startsWith('}')) {
      stack.pop()
      i += 1
      continue
    }
    if (line.endsWith('{')) {
      stack.push(line.slice(0, -1).trim())
      i += 1
      continue
    }
    const m = /^([-\w]+)\s*:\s*([\s\S]*)$/.exec(line)
    if (m !== null && !line.startsWith('@')) {
      const prop = m[1]
      let value = m[2]
      const start = i
      while (!hasTopSemicolon(value) && i + 1 < lines.length) {
        i += 1
        value += ` ${lines[i].trim()}`
        if (lines[i].includes('}')) break
      }
      value = value.replace(/;\s*$/, '').replace(/\}\s*$/, '').trim()
      decls.push({ file: relative(ROOT, file), line: start + 1, selector: stack[stack.length - 1] ?? '', prop, value })
      i += 1
      continue
    }
    i += 1
  }
  return decls
}

/** 扫描 value 中所有 var(--name[, fallback])，返回 [{name,fallback}]（按出现序）。 */
function parseVarRefs(value) {
  const refs = []
  let i = 0
  while (i < value.length) {
    const at = value.indexOf('var(', i)
    if (at === -1) break
    let depth = 0
    let j = at + 4
    let comma = -1
    for (; j < value.length; j += 1) {
      const ch = value[j]
      if (ch === '(') depth += 1
      else if (ch === ')') {
        if (depth === 0) break
        depth -= 1
      } else if (ch === ',' && depth === 0 && comma === -1) comma = j
    }
    if (j >= value.length) break
    const inner = value.slice(at + 4, j)
    const nameRaw = (comma === -1 ? inner : inner.slice(0, comma - (at + 4))).trim()
    const fallback = comma === -1 ? undefined : inner.slice(comma - (at + 4) + 1).trim()
    refs.push({ name: nameRaw, fallback, start: at, end: j + 1 })
    i = j + 1
  }
  return refs
}

const norm = (v) => String(v).replace(/\s+/g, ' ').replace(/\s*([,()])\s*/g, '$1').trim()

/**
 * 递归解析 var() 链。defs: Map<key,{light,dark}>（值可为 var() 引用）。
 * 返回 {ok, value, missing[]}；无 fallback 且未定义 → ok:false（属性整条失效，等价 RED）。
 */
function resolveValue(raw, mode, defs, trail = []) {
  let cur = String(raw)
  const missing = []
  for (let round = 0; round < 30; round += 1) {
    const refs = parseVarRefs(cur)
    if (refs.length === 0) return { ok: missing.length === 0, value: norm(cur), missing }
    const ref = refs[0]
    if (!ref.name.startsWith('--')) return { ok: false, value: norm(cur), missing: [`bad-var:${ref.name}`] }
    if (trail.includes(ref.name)) return { ok: false, value: norm(cur), missing: [`cycle:${ref.name}`] }
    const def = defs.get(ref.name)
    if (def === undefined) {
      if (ref.fallback !== undefined) {
        const fb = resolveValue(ref.fallback, mode, defs, trail)
        cur = cur.slice(0, ref.start) + fb.value + cur.slice(ref.end)
        if (!fb.ok) missing.push(...fb.missing)
      } else {
        missing.push(ref.name)
        cur = cur.slice(0, ref.start) + `__UNRESOLVED__(${ref.name})` + cur.slice(ref.end)
      }
      continue
    }
    const nextRaw = def[mode]
    const resolved = resolveValue(nextRaw, mode, defs, [...trail, ref.name])
    cur = cur.slice(0, ref.start) + resolved.value + cur.slice(ref.end)
    if (!resolved.ok) missing.push(...resolved.missing)
  }
  return { ok: false, value: norm(cur), missing: ['depth-limit'] }
}

// ── app.less 解析与基线 token 表 ─────────────────────────────────────────
function parseAppLess() {
  const file = join(ROOT, 'app.less')
  const decls = scanLessDecls(file)
  const pageDefs = decls.filter((d) => d.selector === 'page' && d.prop.startsWith('--'))
  const darkDefs = decls.filter((d) => d.selector === '.theme-dark' && d.prop.startsWith('--'))
  const pageMap = new Map(pageDefs.map((d) => [d.prop, d.value]))
  const darkMap = new Map(darkDefs.map((d) => [d.prop, d.value]))
  const tokens = {}
  for (const d of pageDefs) {
    tokens[d.prop] = {
      light: d.value,
      dark: darkMap.get(d.prop) ?? d.value,
      darkOverridden: darkMap.has(d.prop),
      line: d.line,
      derived: DERIVED_KEYS.has(d.prop),
    }
  }
  // frame-0 背景（旧 @media page{background}）——新侧由 skin.gen 的 @media 承接
  const frameZero = decls.find((d) => d.selector === 'page' && d.prop === 'background' && d.value.startsWith('#'))?.value ?? null
  return { tokens, pageDefs, darkDefs, frameZero }
}

function defsFromTokens(tokens) {
  const defs = new Map()
  for (const [key, v] of Object.entries(tokens)) defs.set(key, { light: v.light, dark: v.dark })
  return defs
}

// ── 消费点扫描 ───────────────────────────────────────────────────────────
function scanConsumptionPoints(files, defs) {
  const points = []
  const occurrence = new Map()
  const varCounts = {}
  for (const file of files) {
    const decls = scanLessDecls(file)
    const rel = relative(ROOT, file)
    let count = 0
    for (const d of decls) {
      // 独立 grep 对账口径 = 原始文本 var(-- 出现次数（含 token 定义行/嵌套 fallback）
      if (d.value.includes('var(--')) count += (d.value.match(/var\(--/g) ?? []).length
      if (d.prop.startsWith('--')) continue
      if (!d.value.includes('var(--')) continue
      const identity = `${d.selector}|${d.prop}`
      const idx = occurrence.get(`${rel}#${identity}`) ?? 0
      occurrence.set(`${rel}#${identity}`, idx + 1)
      points.push({
        file: rel,
        line: d.line,
        selector: d.selector,
        prop: d.prop,
        raw: d.value,
        key: `${rel}#${identity}#${idx}`,
        light: resolveValue(d.value, 'light', defs),
        dark: resolveValue(d.value, 'dark', defs),
      })
    }
    // 独立 grep 对账：raw 文本 var(-- 出现次数（注释内若有也算——差必须可解释）
    const rawText = readFileSync(file, 'utf8')
    varCounts[rel] = { grep: (rawText.match(/var\(--/g) ?? []).length, scanner: count }
  }
  return { points, varCounts }
}

// ── 非 less 值源快照 ──────────────────────────────────────────────────────
function snapshotNonLess(includeThemeTs = true) {
  const themeTs = includeThemeTs && existsSync(join(ROOT, 'services/theme.ts')) ? readFileSync(join(ROOT, 'services/theme.ts'), 'utf8') : ''
  const front = themeTs.length === 0 ? null : /frontColor:\s*theme === 'dark' \? '(#[0-9a-fA-F]+)' : '(#[0-9a-fA-F]+)'/.exec(themeTs)
  const layer2 = themeTs.length === 0 ? null : /surface === 'layer-2'\s*\n?\s*\? \(theme === 'dark' \? '([^']+)' : '([^']+)'\)/.exec(themeTs)
  const base = themeTs.length === 0 ? null : /:\s*\(theme === 'dark' \? '([^']+)' : '([^']+)'\)/.exec(themeTs)
  const pull = themeTs.length === 0 ? null : /const bg = theme === 'dark' \? '([^']+)' : '([^']+)'/.exec(themeTs)
  const chrome = {
    navFront: front === null ? null : { light: front[2], dark: front[1] },
    navBackgroundBase: base === null ? null : { light: base[2], dark: base[1] },
    navBackgroundLayer2: layer2 === null ? null : { light: layer2[2], dark: layer2[1] },
    pullBackground: pull === null ? null : { light: pull[2], dark: pull[1] },
  }

  const md = readFileSync(join(ROOT, 'services/markdown.ts'), 'utf8')
  const paletteFields = ['text', 'secondary', 'tertiary', 'border', 'link', 'codeBg', 'codeBanner', 'codeText', 'inlineBg', 'tableHeadBg', 'tableRowAlt']
  const blockOf = (mode) => {
    const re = mode === 'dark'
      ? /return theme === 'dark'\s*\n\s*\? \{([\s\S]*?)\}\s*\n\s*: \{/
      : /: \{([\s\S]*?)\}\s*\n\}/
    return re.exec(md)?.[1] ?? ''
  }
  const parsePalette = (block) => {
    const out = {}
    for (const f of paletteFields) {
      const m = new RegExp(`${f}:\\s*'([^']+)'`).exec(block)
      out[f] = m === null ? null : m[1]
    }
    return out
  }
  const palette = { light: parsePalette(blockOf('light')), dark: parsePalette(blockOf('dark')) }
  const menlo = []
  md.split('\n').forEach((line, i) => {
    if (line.includes('Menlo,monospace')) menlo.push({ line: i + 1, value: 'Menlo,monospace' })
  })
  return { chrome, palette, menlo }
}

function snapshotThemeJson() {
  const cur = readFileSync(join(ROOT, 'theme.json'), 'utf8')
  let headBlob = null
  try {
    headBlob = execFileSync('git', ['rev-parse', 'HEAD:theme.json'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch { /* first-run boundary */ }
  return {
    content: cur,
    contentSha256: createHash('sha256').update(cur).digest('hex'),
    headBlob,
  }
}

// ── 基线 ─────────────────────────────────────────────────────────────────
function buildBaseline() {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const appLess = parseAppLess()
  const defs = defsFromTokens(appLess.tokens)
  const lessFiles = [join(ROOT, 'app.less'), ...walkLess(join(ROOT, 'pages')), ...walkLess(join(ROOT, 'components'))]
  const { points, varCounts } = scanConsumptionPoints(lessFiles, defs)
  const nonLess = snapshotNonLess()
  const themeJson = snapshotThemeJson()
  const tokenCounts = {
    entries: Object.keys(appLess.tokens).length,
    derived: Object.values(appLess.tokens).filter((t) => t.derived).length,
    projected: Object.values(appLess.tokens).filter((t) => !t.derived).length,
    darkOverrides: appLess.darkDefs.length,
  }
  const varDiff = Object.entries(varCounts)
    .map(([f, c]) => ({ file: f, ...c, diff: c.grep - c.scanner }))
    .filter((r) => r.diff !== 0)

  return {
    tool: 'skin-equiv-check.mjs',
    version: 1,
    envelope: {
      headSha,
      dirtyWorktree: porcelain.length > 0,
      generatedAt: new Date().toISOString(),
      sourceFiles: lessFiles.map((f) => relative(ROOT, f)).concat(['services/theme.ts', 'services/markdown.ts', 'theme.json']),
    },
    tokenCounts,
    tokens: appLess.tokens,
    frameZero: appLess.frameZero,
    consumptionPoints: points.map((p) => ({
      file: p.file, line: p.line, selector: p.selector, prop: p.prop, key: p.key,
      raw: p.raw,
      light: p.light,
      dark: p.dark,
    })),
    nonLess: { ...nonLess, themeJson },
    varCounts,
    varDiff,
  }
}

function assertBaselineIntact(baseline) {
  if (!existsSync(PIN_FILE)) {
    console.error('FATAL: 基线 pin 缺失（.anote/ms01-baseline/baseline.pin.json）——基线不可信')
    process.exit(2)
  }
  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8'))
  const actualSha = createHash('sha256').update(readFileSync(BASELINE_FILE)).digest('hex')
  const problems = []
  if (pin.headSha !== baseline.envelope.headSha) problems.push(`pin.headSha(${pin.headSha}) != baseline.headSha(${baseline.envelope.headSha})`)
  if (pin.baselineSha256 !== actualSha) problems.push('baseline 文件被改写（sha256 不符 pin）')
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', baseline.envelope.headSha, 'HEAD'], { cwd: ROOT, stdio: 'ignore' })
  } catch {
    problems.push(`baseline headSha ${baseline.envelope.headSha} 不是当前 HEAD 的祖先`)
  }
  if (problems.length > 0) {
    console.error('FATAL: 基线完整性校验失败：\n - ' + problems.join('\n - '))
    process.exit(2)
  }
}

// ── TS 模块加载（vocab/palette-map） ──────────────────────────────────────
function loadTsModule(file) {
  const source = readFileSync(file, 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', 'require', js)(mod.exports, mod, () => { throw new Error('no require') })
  return mod.exports
}

function vocabDefsFrom(vocab) {
  const defs = new Map()
  for (const [key, entry] of Object.entries(vocab.tokens)) defs.set(key, { light: entry.light, dark: entry.dark })
  for (const [key, entry] of Object.entries(vocab.surfaces ?? {})) defs.set(entry.emits, { light: entry.default, dark: entry.default })
  for (const contract of Object.values(vocab.components ?? {})) {
    for (const [key, domain] of Object.entries(contract?.vars ?? {})) {
      if (domain !== null && typeof domain === 'object' && typeof domain.default === 'string') {
        defs.set(key, { light: domain.default, dark: domain.default })
      }
    }
  }
  return defs
}

// ── 对照 ─────────────────────────────────────────────────────────────────
function compareTokenDefaults(baselineTokens, vocab, defs) {
  const errors = []
  const projected = Object.entries(baselineTokens).filter(([, v]) => !v.derived)
  for (const [key, old] of projected) {
    const now = vocab.tokens[key]
    if (now === undefined) { errors.push(`vocab 缺键: ${key}`); continue }
    for (const mode of ['light', 'dark']) {
      const oldResolved = resolveValue(old[mode], mode, defsFromTokens(baselineTokens))
      const newResolved = resolveValue(now[mode], mode, defs)
      if (oldResolved.value !== newResolved.value) {
        errors.push(`token 值漂移 ${key}.${mode}: ${oldResolved.value} → ${newResolved.value}`)
      }
    }
  }
  for (const [key, v] of Object.entries(baselineTokens)) {
    if (v.derived && vocab.tokens[key] !== undefined) errors.push(`derived 键不应投影: ${key}`)
  }
  return { errors, projected }
}

function compare(phase) {
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  assertBaselineIntact(baseline)
  const vocab = loadTsModule(join(ROOT, "services/skin/vocab.ts")).VOCAB
  const paletteMap = loadTsModule(join(ROOT, 'services/skin/palette-map.ts')).PALETTE_MAP
  const defs = vocabDefsFrom(vocab)
  const diffs = []
  const intended = []
  const intendedAdditions = []
  const errors = []
  const auditBaseline = JSON.parse(readFileSync(join(ROOT, '.anote/ms01-baseline/token-audit.json'), 'utf8'))
  const auditByFileLine = new Map()
  for (const list of Object.values(auditBaseline.violations)) {
    for (const v of list) auditByFileLine.set(`${v.file}:${v.line}`, v.text)
  }

  // 1) token defaults（全 phase 都跑）
  const baselineTokens = baseline.tokens
  const tokenCheck = compareTokenDefaults(baselineTokens, vocab, defs)
  errors.push(...tokenCheck.errors)
  const projected = tokenCheck.projected
  const newKeys = Object.keys(vocab.tokens).filter((k) => baselineTokens[k] === undefined)
  const expectedNew = ['--dsw-alias-bg-mask-3', '--dsw-alias-markdown-code-text', '--dsw-blur-surface', '--dsw-alias-markdown-tertiary', '--dsw-alias-markdown-table-row-alt']
  for (const key of expectedNew) {
    if (!newKeys.includes(key)) errors.push(`T-O-8 新键未投影: ${key}`)
  }
  for (const key of newKeys) if (!expectedNew.includes(key)) errors.push(`未登记新键: ${key}`)

  if (phase === 'p4') {
    return finish({ phase, diffs, intended, errors, checks: { tokenCount: projected.length, newKeys } })
  }

  // 2) 消费点（P6）
  const lessFiles = [join(ROOT, 'app.less'), ...walkLess(join(ROOT, 'pages')), ...walkLess(join(ROOT, 'components'))]
  const { points } = scanConsumptionPoints(lessFiles, defs)
  const byKey = new Map(points.map((p) => [p.key, p]))
  const baselineByKey = new Map(baseline.consumptionPoints.map((p) => [p.key, p]))
  for (const old of baseline.consumptionPoints) {
    const now = byKey.get(old.key)
    if (now === undefined) {
      errors.push(`消费点消失: ${old.file}:${old.line} ${old.selector} { ${old.prop} }`)
      continue
    }
    for (const mode of ['light', 'dark']) {
      const o = old[mode]
      const n = now[mode]
      if (o.ok !== n.ok) {
        // 计划内修复：旧 unresolved（无兜底 bug）→ 新 resolved
        const refs = parseVarRefs(old.raw)
        const fixed = refs.find((r) => INTENDED_RETARGET.has(r.name) || NEW_TOKEN_KEYS.has(r.name))
        const expected = fixed === undefined ? undefined : expectedIntendedValue(fixed.name, mode, vocab, defs)
        if (o.ok === false && n.ok === true && fixed !== undefined && expected !== null && n.value === expected) {
          intended.push({ key: old.key, file: old.file, line: now.line, mode, from: o.value, to: n.value, reason: `T-O-8:${fixed.name}`, expected })
        } else {
          errors.push(`消费点 resolved 状态变化 ${old.key} ${mode}: ${JSON.stringify(o)} → ${JSON.stringify(n)}`)
        }
        continue
      }
      if (o.value !== n.value) {
        const refs = parseVarRefs(old.raw)
        const fixed = refs.find((r) => INTENDED_RETARGET.has(r.name) || NEW_TOKEN_KEYS.has(r.name))
        const expected = fixed === undefined ? undefined : expectedIntendedValue(fixed.name, mode, vocab, defs)
        if (fixed !== undefined && expected !== null && n.value === expected) {
          intended.push({ key: old.key, file: old.file, line: now.line, mode, from: o.value, to: n.value, reason: `T-O-8:${fixed.name}`, expected })
        } else {
          errors.push(`消费点值漂移 ${old.key} ${mode}: ${o.value} → ${n.value}`)
        }
      }
    }
  }
  const ledgerPath = join(ROOT, 'test/spike/mini-skin/component-literal-ledger.json')
  const ledgerDecls = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')).declarations ?? [] : []
  for (const now of points) {
    if (baselineByKey.has(now.key)) continue
    // MS02：裸字面量改成无兜底 var() 时，解析值必须等于 P0 台账，不刷新 baseline pin。
    const ledgerHit = ledgerDecls.find((d) => d.file === now.file && d.line === now.line && d.prop === now.prop)
    const refs = parseVarRefs(now.raw)
    if (ledgerHit !== undefined && refs.length === 1 && refs[0].fallback === undefined && now.light.ok && now.dark.ok && norm(now.light.value) === norm(ledgerHit.value) && norm(now.dark.value) === norm(ledgerHit.value)) {
      intendedAdditions.push({ file: now.file, line: now.line, selector: now.selector, prop: now.prop, value: ledgerHit.value, reason: 'MS02-equal-literal' })
      continue
    }
    // P4 token-audit 清零把裸字面量换成 var()——新增消费点必须是「等值 tokenization」
    const auditText = auditByFileLine.get(`${now.file}:${now.line}`)
    if (auditText === undefined) {
      errors.push(`新增消费点（需登记）: ${now.file}:${now.line} ${now.selector} { ${now.prop} }`)
      continue
    }
    const decl = /^([-\w]+)\s*:\s*(.+);$/.exec(auditText)
    if (decl === null) { errors.push(`新增消费点无法对账: ${now.file}:${now.line} ${auditText}`); continue }
    const oldLiteral = norm(decl[2])
    const equal = ['light', 'dark'].every((mode) => now[mode].ok && now[mode].value === oldLiteral)
    if (!equal) {
      errors.push(`tokenization 不等值 ${now.file}:${now.line} ${auditText} → ${now.light.value}/${now.dark.value}`)
      continue
    }
    intendedAdditions.push({ file: now.file, line: now.line, selector: now.selector, prop: now.prop, value: oldLiteral, reason: 'T07-tokenization' })
  }

  // 3) 非 less 值源（P5 后 theme.ts 已删：chrome 期望值从 vocab 推导）
  const baseNon = baseline.nonLess
  const chromeNow = {
    navFront: { light: vocab.chrome.navFront.light, dark: vocab.chrome.navFront.dark },
    navBackgroundBase: { light: vocab.tokens['--dsw-alias-bg-base'].light, dark: vocab.tokens['--dsw-alias-bg-base'].dark },
    navBackgroundLayer2: { light: vocab.tokens['--dsw-alias-bg-layer-2'].light, dark: vocab.tokens['--dsw-alias-bg-layer-2'].dark },
    pullBackground: { light: vocab.chrome.pullBackground.light, dark: vocab.chrome.pullBackground.dark },
  }
  for (const [k, old] of Object.entries(baseNon.chrome)) {
    const now = chromeNow[k]
    for (const mode of ['light', 'dark']) {
      if (old?.[mode] !== now?.[mode]) errors.push(`chrome.${k}.${mode}: ${old?.[mode]} → ${now?.[mode]}`)
    }
  }
  for (const mode of ['light', 'dark']) {
    for (const field of Object.keys(baseNon.palette[mode])) {
      const map = paletteMap[field]
      if (map === undefined) { errors.push(`palette-map 缺字段: ${field}`); continue }
      const newVal = 'token' in map ? (vocab.tokens[map.token]?.[mode] ?? '') : map.literal[mode]
      const oldVal = norm(baseNon.palette[mode][field])
      if (norm(newVal) !== oldVal) errors.push(`markdown palette ${mode}.${field}: ${oldVal} → ${norm(newVal)}`)
    }
  }
  const mdSrc = readFileSync(join(ROOT, 'services/markdown.ts'), 'utf8')
  if (mdSrc.includes('Menlo,monospace')) errors.push('markdown.ts 仍有 Menlo,monospace 字面量')
  const codeFont = vocab.tokens['--ds-font-family-code']
  if (codeFont === undefined) errors.push('缺 --ds-font-family-code')
  else if (norm(codeFont.light) !== 'Menlo,"SFMono-Regular",Consolas,monospace') {
    errors.push(`--ds-font-family-code 值异常: ${codeFont.light}`)
  }
  const curTheme = readFileSync(join(ROOT, 'theme.json'), 'utf8')
  if (curTheme !== baseNon.themeJson.content) errors.push('theme.json 与 P0 基线逐字节不等')

  return finish({ phase, diffs, intended, intendedAdditions, errors, checks: { tokenCount: projected.length, newKeys, consumptionPoints: points.length } })
}

function finish({ phase, diffs, intended, intendedAdditions = [], errors, checks }) {
  const report = {
    ok: errors.length === 0,
    phase,
    at: new Date().toISOString(),
    checks,
    errors,
    diffs: errors,
    intendedDeltas: intended,
    intendedAdditions,
  }
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

// ── self-test：篡改断言 ───────────────────────────────────────────────────
function selfTest() {
  const raw = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  const vocab = loadTsModule(join(ROOT, 'services/skin/vocab.ts')).VOCAB
  const victimKey = '--dsw-alias-bg-base'
  const victim = raw.tokens[victimKey]
  if (victim === undefined) { console.error('self-test: 基线缺 victim 键'); process.exit(2) }
  const tampered = JSON.parse(JSON.stringify(raw))
  tampered.tokens[victimKey].light = 'rgb(1, 2, 3)'
  const defs = defsFromTokens(tampered.tokens)
  const result = compareTokenDefaults(tampered.tokens, vocab, defs)
  const fired = result.errors.filter((e) => e.includes(victimKey))
  if (fired.length === 0) {
    console.error('FATAL: self-test plant 未触发 diff（判具可能恒真）')
    process.exit(2)
  }
  console.log(JSON.stringify({ ok: true, plant: 'tamper-baseline-key', key: victimKey, tampered: 'rgb(1, 2, 3)', baseline: norm(victim.light), simulatedDiff: fired }, null, 2))
}

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1] }

if (flag('--baseline')) {
  if (existsSync(BASELINE_FILE) && !flag('--force')) {
    console.error(`FATAL: 基线已存在，拒绝覆写（防迁移后污染）：${relative(ROOT, BASELINE_FILE)}；确需重建加 --force`)
    process.exit(2)
  }
  mkdirSync(join(ROOT, '.anote/ms01-baseline'), { recursive: true })
  const baseline = buildBaseline()
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2))
  writeFileSync(PIN_FILE, JSON.stringify({
    headSha: baseline.envelope.headSha,
    baselineSha256: createHash('sha256').update(readFileSync(BASELINE_FILE)).digest('hex'),
    at: new Date().toISOString(),
  }, null, 2))
  console.log(JSON.stringify({
    ok: true,
    file: relative(ROOT, BASELINE_FILE),
    headSha: baseline.envelope.headSha,
    dirtyWorktree: baseline.envelope.dirtyWorktree,
    tokenCounts: baseline.tokenCounts,
    consumptionPoints: baseline.consumptionPoints.length,
    varDiff: baseline.varDiff,
  }, null, 2))
  process.exit(baseline.varDiff.length === 0 ? 0 : 1)
} else if (flag('--check')) {
  compare(value('--phase', 'p6'))
} else if (flag('--self-test')) {
  selfTest()
} else {
  console.error('用法: skin-equiv-check.mjs --baseline [--force] | --check [--phase p4|p6] | --self-test')
  process.exit(2)
}
