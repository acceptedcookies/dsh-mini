#!/usr/bin/env node
/**
 * build-skin.mjs — MS01 单管线：skin/truth/*.ts → 五产物（T-O-1/T-O-3/T-O-9）
 *
 * 产物（--check 文件级逐字节 ×5）：
 *   1. skin.gen.wxss                    page{light 134 键} + @media dark page{55 键}
 *   2. services/skin/vocab.ts           运行时词表（token/surfaces/sounds/assets/chrome/components）
 *   3. services/skin/palette-map.ts     markdown Palette 11 字段映射
 *   4. assets/skins/dsh-default.json    默认皮肤参照件（skin v1 同构件）
 *   5. theme.json                       平台静态 chrome（替代 build-theme.mjs）
 *
 * 用法:
 *   node scripts/build-skin.mjs           重建全部产物 + 更新 app.less GEN 注释行
 *   node scripts/build-skin.mjs --check   只校验（漂移 exit 1；不写盘）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const CHECK = process.argv.includes('--check')

// ── 迷你 TS loader ───────────────────────────────────────────────────────
function requireTs(file) {
  const src = readFileSync(file, 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const dir = dirname(file)
  const req = (spec) => {
    if (spec.startsWith('.')) {
      let p = resolve(dir, spec)
      if (!p.endsWith('.ts')) p += '.ts'
      return requireTs(p)
    }
    throw new Error(`build-skin 不支持外部依赖: ${spec}`)
  }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(mod.exports, req, mod, file, dir)
  return mod.exports
}

const truth = requireTs(join(ROOT, 'skin/truth/index.ts'))
const { ALL_TOKEN_ENTRIES, PROJECTED_ENTRIES, SURFACE_ENTRIES, ASSET_ENTRIES, CHROME_ENTRIES, SOUND_ENTRIES, COMPONENT_ENTRIES, CONTRACT_FILE_GLOB } = truth
const { EMPTY_COMPONENTS } = { EMPTY_COMPONENTS: COMPONENT_ENTRIES }

// ── 契约断言 ─────────────────────────────────────────────────────────────
const problems = []
if (ALL_TOKEN_ENTRIES.length !== 151) problems.push(`entries=${ALL_TOKEN_ENTRIES.length} != 151`)
if (PROJECTED_ENTRIES.length !== 134) problems.push(`projected=${PROJECTED_ENTRIES.length} != 134`)
const derived = ALL_TOKEN_ENTRIES.filter((e) => e.derived)
if (derived.length !== 17) problems.push(`derived=${derived.length} != 17`)
const invariant = ALL_TOKEN_ENTRIES.filter((e) => e.invariant)
if (invariant.length !== 16) problems.push(`invariant=${invariant.length} != 16`)
for (const e of ALL_TOKEN_ENTRIES) {
  if ((e.invariant || e.derived) && e.writable) problems.push(`${e.key} invariant/derived 但 writable=true`)
  for (const k of e.linkedWith) {
    if (!ALL_TOKEN_ENTRIES.some((x) => x.key === k)) problems.push(`${e.key} linkedWith 指向未知键 ${k}`)
  }
}
const emits = SURFACE_ENTRIES.map((s) => s.emits)
if (new Set(emits).size !== emits.length) problems.push('surface emits 不唯一')
if (SURFACE_ENTRIES.length !== 15) problems.push(`surfaces=${SURFACE_ENTRIES.length} != 15`)

// contract glob 覆盖：发现 contract 文件 → 必须收编进 components registry
function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith('.contract.ts')) out.push(p)
  }
  return out
}
const contractFiles = existsSync(join(ROOT, 'components')) ? walkFiles(join(ROOT, 'components')) : []
const contracts = []
for (const file of contractFiles) {
  const mod = requireTs(file)
  const manifest = mod.CONTRACT ?? mod.default
  if (manifest === undefined) { problems.push(`${relative(ROOT, file)} 缺 CONTRACT/default 导出`); continue }
  const name = relative(ROOT, file).split('/')[1] ?? file
  contracts.push({ name, manifest })
}
const componentNames = new Set(COMPONENT_ENTRIES.map((c) => c.name).concat(contracts.map((c) => c.name)))
for (const c of contracts) {
  if (!COMPONENT_ENTRIES.some((x) => x.name === c.name)) problems.push(`contract 未收编进 components registry: ${c.name}`)
}
if (problems.length > 0) {
  console.error('FATAL: build-skin 契约断言失败：\n - ' + problems.join('\n - '))
  process.exit(1)
}

// ── 产物 1：skin.gen.wxss ────────────────────────────────────────────────
function cssDecls(entries, mode) {
  return entries.map((e) => `  ${e.key}: ${mode === 'light' ? e.light : e.dark};`).join('\n')
}
const darkEntries = PROJECTED_ENTRIES.filter((e) => e.darkOverridden || e.dark !== e.light)
const skinGen = [
  '/* GENERATED — do not edit. source: skin/truth/*.ts (MS01) */',
  'page {',
  cssDecls(PROJECTED_ENTRIES, 'light'),
  '}',
  '',
  '@media (prefers-color-scheme: dark) {',
  '  page {',
  darkEntries.map((e) => `    ${e.key}: ${e.dark};`).join('\n'),
  '  }',
  '}',
  '',
].join('\n')

// ── 产物 2：vocab.ts ─────────────────────────────────────────────────────
const vocabTokens = {}
for (const e of PROJECTED_ENTRIES) {
  vocabTokens[e.key] = {
    key: e.key, family: e.family, domain: e.domain, light: e.light, dark: e.dark,
    writable: e.writable, invariant: e.invariant, derived: e.derived, linkedWith: e.linkedWith,
  }
}
const vocabSurfaces = {}
for (const s of SURFACE_ENTRIES) vocabSurfaces[s.key] = { key: s.key, emits: s.emits, default: s.default, points: s.points }
const vocabChrome = {}
for (const c of CHROME_ENTRIES) vocabChrome[c.key] = { light: c.light, dark: c.dark }
const vocabComponents = {}
for (const c of COMPONENT_ENTRIES.concat(contracts)) vocabComponents[c.name] = c.manifest

const vocabTs = `/* GENERATED — do not edit. source: skin/truth/*.ts (MS01 build-skin.mjs) */
export interface VocabToken {
  key: string
  family: string
  domain: string
  light: string
  dark: string
  writable: boolean
  invariant: boolean
  derived: boolean
  linkedWith: string[]
}
export interface VocabSurface {
  key: string
  emits: string
  default: string
  points: Array<{ file: string; line: number; use: string }>
}
export const VOCAB = {
  schema: 'dsh-mini.skin.vocab.v1',
  tokens: ${JSON.stringify(vocabTokens, null, 2)} as Record<string, VocabToken>,
  surfaces: ${JSON.stringify(vocabSurfaces, null, 2)} as Record<string, VocabSurface>,
  sounds: ${JSON.stringify(SOUND_ENTRIES.map((s) => s.key))},
  assets: ${JSON.stringify(ASSET_ENTRIES.map((a) => a.key))},
  chrome: ${JSON.stringify(vocabChrome, null, 2)} as Record<string, { light: string; dark: string }>,
  components: ${JSON.stringify(vocabComponents, null, 2)} as Record<string, unknown>,
  contractGlob: ${JSON.stringify(CONTRACT_FILE_GLOB)},
  derivedKeys: ${JSON.stringify(ALL_TOKEN_ENTRIES.filter((e) => e.derived).map((e) => e.key))},
} as const

export const VOCAB_TOKENS = VOCAB.tokens
export type Vocab = typeof VOCAB
`

// ── 产物 3：palette-map.ts ───────────────────────────────────────────────
// tableRowAlt 在 151 词表内无对应 token（0.02/0.03 alpha 无同值键）——以 literal 明确登记，
// 不作静默硬编码；MS02 词表扩展时转 token（执行日志已登记）。
const paletteMap = {
  text: { token: '--dsw-alias-label-primary' },
  secondary: { token: '--dsw-alias-label-secondary' },
  tertiary: { token: '--dsw-alias-label-tertiary' },
  border: { token: '--dsw-alias-border-l2' },
  link: { token: '--dsw-alias-state-business-primary' },
  codeBg: { token: '--dsw-alias-markdown-code-block' },
  codeBanner: { token: '--dsw-alias-markdown-code-block-banner' },
  codeText: { token: '--dsw-alias-markdown-code-text' },
  inlineBg: { token: '--dsw-alias-markdown-inline-code' },
  tableHeadBg: { token: '--dsw-alias-markdown-code-block-banner' },
  tableRowAlt: { literal: { light: 'rgba(0,0,0,0.02)', dark: 'rgba(255,255,255,0.03)' } },
}
const paletteMapTs = `/* GENERATED — do not edit. source: skin/truth/*.ts (MS01 build-skin.mjs) */
export type PaletteFieldMap = { token: string } | { literal: { light: string; dark: string } }
export const PALETTE_MAP: Record<string, PaletteFieldMap> = ${JSON.stringify(paletteMap, null, 2)}

/** 11 字段全覆盖断言（T14） */
export const PALETTE_FIELDS = ${JSON.stringify(Object.keys(paletteMap))}
`

// ── 产物 4：dsh-default.json ─────────────────────────────────────────────
const writable = PROJECTED_ENTRIES.filter((e) => e.writable)
function familyBlock(mode) {
  const out = { palette: {}, shape: {}, spacing: {}, typography: {}, elevation: {}, surfaces: {} }
  for (const e of writable) {
    const family = e.family === 'effects' ? 'effects' : e.family
    if (out[family] === undefined) out[family] = {}
    out[family][e.key] = mode === 'light' ? e.light : e.dark
  }
  for (const s of SURFACE_ENTRIES) out.surfaces[s.key] = s.default
  return out
}
const chromeBlock = (mode) => Object.fromEntries(CHROME_ENTRIES.map((c) => [c.key, c[mode]]))
const dshDefault = {
  $schema: 'dsh-mini.skin.v1',
  slug: 'dsh-default',
  name: '默认',
  fonts: [],
  sounds: {},
  components: {},
  light: { ...familyBlock('light'), chrome: chromeBlock('light') },
  dark: { ...familyBlock('dark'), chrome: chromeBlock('dark') },
}
const dshDefaultJson = JSON.stringify(dshDefault, null, 2) + '\n'

// ── 产物 5：theme.json ───────────────────────────────────────────────────
const chromeVal = (key, mode) => CHROME_ENTRIES.find((c) => c.key === key)[mode]
const themeJson = JSON.stringify({
  light: {
    navigationBarBackgroundColor: chromeVal('navBackground', 'light'),
    navigationBarTextStyle: 'black',
    backgroundColor: chromeVal('pullBackground', 'light'),
    backgroundColorTop: chromeVal('pullBackground', 'light'),
    backgroundColorBottom: chromeVal('pullBackground', 'light'),
    backgroundTextStyle: 'dark',
  },
  dark: {
    navigationBarBackgroundColor: chromeVal('navBackground', 'dark'),
    navigationBarTextStyle: 'white',
    backgroundColor: chromeVal('pullBackground', 'dark'),
    backgroundColorTop: chromeVal('pullBackground', 'dark'),
    backgroundColorBottom: chromeVal('pullBackground', 'dark'),
    backgroundTextStyle: 'light',
  },
}, null, 2) + '\n'

const products = [
  { file: 'skin.gen.wxss', content: skinGen },
  { file: 'services/skin/vocab.ts', content: vocabTs },
  { file: 'services/skin/palette-map.ts', content: paletteMapTs },
  { file: 'assets/skins/dsh-default.json', content: dshDefaultJson },
  { file: 'theme.json', content: themeJson },
]

// ── app.less GEN 注释行（E1-3 重编译触发） ──────────────────────────────
const contentHash = createHash('sha256').update(products.map((p) => p.content).join('\n')).digest('hex').slice(0, 16)
const genLine = `/* GEN:${contentHash} */`
function syncAppLessGen(write) {
  const file = join(ROOT, 'app.less')
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const idx = lines.findIndex((l) => l.startsWith('/* GEN:'))
  if (idx === -1) {
    if (!write) return { ok: false, actual: null }
    // 追加在文件末尾：不移动任何既有行号（source/points 锚保持稳定）
    const trimmed = src.replace(/\n*$/, '\n')
    writeFileSync(file, `${trimmed}${genLine}\n`)
    return { ok: true, actual: genLine }
  }
  const actual = lines[idx]
  if (actual !== genLine) {
    if (!write) return { ok: false, actual }
    lines[idx] = genLine
    writeFileSync(file, lines.join('\n'))
  }
  return { ok: true, actual: genLine }
}

// ── 执行 ─────────────────────────────────────────────────────────────────
let failed = false
const report = { mode: CHECK ? 'check' : 'build', products: [], genLine, contentHash }
for (const p of products) {
  const abs = join(ROOT, p.file)
  const exists = existsSync(abs)
  const current = exists ? readFileSync(abs, 'utf8') : null
  if (CHECK) {
    const ok = current === p.content
    report.products.push({ file: p.file, status: ok ? 'in-sync' : exists ? 'DRIFT' : 'MISSING' })
    if (!ok) failed = true
  } else {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, p.content)
    report.products.push({ file: p.file, status: 'written', bytes: Buffer.byteLength(p.content) })
  }
}
const gen = syncAppLessGen(!CHECK)
report.appLessGen = gen
if (CHECK && !gen.ok) failed = true

// --check 尾段：dsh-default validate 回验（P3 就绪后挂）
const validatePath = join(ROOT, 'services/skin/validate.ts')
if (existsSync(validatePath)) {
  try {
    const validateMod = requireTs(validatePath)
    const result = validateMod.validate(dshDefault, VOCAB_FOR_VALIDATE())
    report.validate = result
    if (!result.ok) failed = true
  } catch (e) {
    report.validate = { ok: false, error: e instanceof Error ? e.message : String(e) }
    failed = true
  }
} else {
  report.validate = { ok: true, skipped: 'validate-not-ready' }
}
function VOCAB_FOR_VALIDATE() {
  return {
    tokens: vocabTokens,
    surfaces: vocabSurfaces,
    sounds: SOUND_ENTRIES.map((s) => s.key),
    assets: ASSET_ENTRIES.map((a) => a.key),
    chrome: vocabChrome,
    components: vocabComponents,
  }
}
console.log(JSON.stringify(report, null, 2))
process.exit(failed ? 1 : 0)
