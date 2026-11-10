#!/usr/bin/env node
/**
 * node-checks.mjs — MS01 静态/纯函数短验（test/spike/mini-skin 宪章下）
 * 用法: node test/spike/mini-skin/node-checks.mjs [--section A,B,D] [--json]
 * 退出: 0 = 全 PASS；1 = 有 FAIL；2 = 运行错误
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import ts from 'typescript'
import { scanLessDecls } from './classify-literals.mjs'

const ROOT = new URL('../../../', import.meta.url).pathname
const results = []
let currentSection = ''
function section(name) { currentSection = name }
function check(id, fn) {
  try {
    fn()
    results.push({ section: currentSection, id, ok: true })
  } catch (e) {
    results.push({ section: currentSection, id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function eq(a, b, msg) { assert(a === b, `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`) }

// ── 迷你 TS loader（ts.transpileModule + 相对 import 递归） ──────────────
const tsCache = new Map()
function requireTs(file) {
  const cached = tsCache.get(file)
  if (cached !== undefined) return cached.exports
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
    throw new Error(`node-checks 不支持外部依赖: ${spec}`)
  }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(mod.exports, req, mod, file, dir)
  tsCache.set(file, mod)
  return mod.exports
}
const truth = requireTs(resolve(ROOT, 'skin/truth/index.ts'))
const baseline = JSON.parse(readFileSync(resolve(ROOT, '.anote/ms01-baseline/resolved-values.json'), 'utf8'))

// ── §A 真源计数/元数据自洽 ───────────────────────────────────────────────
section('A')
check('A1 entries==154', () => eq(truth.ALL_TOKEN_ENTRIES.length, 154, 'ALL_TOKEN_ENTRIES.length'))
check('A2 projected==137', () => eq(truth.PROJECTED_ENTRIES.length, 137, 'PROJECTED_ENTRIES.length'))
check('A3 derived==17', () => eq(truth.ALL_TOKEN_ENTRIES.filter((e) => e.derived).length, 17, 'derived'))
check('A4 invariant==16', () => eq(truth.ALL_TOKEN_ENTRIES.filter((e) => e.invariant).length, 16, 'invariant'))
check('A5 invariant/derived 不可写', () => {
  for (const e of truth.ALL_TOKEN_ENTRIES) {
    if (e.invariant || e.derived) assert(e.writable === false, `${e.key} writable 应为 false`)
    else assert(e.writable === true, `${e.key} writable 应为 true`)
  }
})
check('A6 键唯一', () => {
  const keys = truth.ALL_TOKEN_ENTRIES.map((e) => e.key)
  eq(new Set(keys).size, keys.length, 'key 唯一性')
})
check('A7 每键 source 可锚', () => {
  for (const e of truth.ALL_TOKEN_ENTRIES) {
    assert(typeof e.source === 'string' && e.source.length > 0, `${e.key} 缺 source`)
    if (!e.key.startsWith('--dsw-alias-bg-mask-3') && !e.key.startsWith('--dsw-alias-markdown-code-text') && e.key !== '--dsw-blur-surface' && e.key !== '--dsw-alias-markdown-tertiary' && e.key !== '--dsw-alias-markdown-table-row-alt') {
      assert(/^app\.less:\d+$/.test(e.source), `${e.key} source 非 app.less:NN: ${e.source}`)
    }
  }
})
check('A8 149 旧键 light/dark 与基线逐键一致', () => {
  eq(Object.keys(baseline.tokens).length, 149, '基线 token 计数')
  for (const [key, old] of Object.entries(baseline.tokens)) {
    const entry = truth.ALL_TOKEN_ENTRIES.find((e) => e.key === key)
    assert(entry !== undefined, `缺基线键 ${key}`)
    eq(entry.light, old.light, `${key}.light`)
    eq(entry.dark, old.dark, `${key}.dark`)
  }
})
check('A9 T-O-8 新键值正确', () => {
  const mask = truth.ALL_TOKEN_ENTRIES.find((e) => e.key === '--dsw-alias-bg-mask-3')
  const code = truth.ALL_TOKEN_ENTRIES.find((e) => e.key === '--dsw-alias-markdown-code-text')
  assert(mask !== undefined && code !== undefined, '缺新键')
  eq(mask.light, 'rgba(0, 0, 0, 0.48)', 'bg-mask-3.light')
  eq(mask.dark, 'rgba(0, 0, 0, 0.56)', 'bg-mask-3.dark')
  eq(code.light, '#0f1115', 'markdown-code-text.light')
  eq(code.dark, '#e6e6e6', 'markdown-code-text.dark')
})
check('A10 族计数自洽', () => {
  const by = {}
  for (const e of truth.ALL_TOKEN_ENTRIES) by[e.family] = (by[e.family] ?? 0) + 1
  eq(by.palette, 89, 'palette')
  eq(by.shape, 11, 'shape')
  eq(by.spacing, 16, 'spacing')
  eq(by.typography, 33, 'typography')
  eq(by.elevation, 4, 'elevation')
})

// ── §B surfaces emits + points ───────────────────────────────────────────
section('B')
check('B1 15 键且唯一', () => {
  eq(truth.SURFACE_ENTRIES.length, 15, 'surface count')
  eq(new Set(truth.SURFACE_ENTRIES.map((s) => s.key)).size, 15, 'surface key 唯一')
})
check('B2 emits 合法 dashed-ident 且唯一', () => {
  const re = /^--dsw-surface-[a-z0-9]+(?:-[a-z0-9]+)*$/
  const emits = truth.SURFACE_ENTRIES.map((s) => s.emits)
  for (const s of truth.SURFACE_ENTRIES) assert(re.test(s.emits), `${s.key} emits 非法: ${s.emits}`)
  eq(new Set(emits).size, emits.length, 'emits 唯一')
})
check('B3 dotted key sanitize', () => {
  const bubble = truth.SURFACE_ENTRIES.find((s) => s.key === 'chat.bubble-user')
  assert(bubble !== undefined, '缺 chat.bubble-user')
  eq(bubble.emits, '--dsw-surface-chat-bubble-user', 'dotted sanitize')
  eq(truth.SURFACE_ENTRIES.find((s) => s.key === 'banner.notice').emits, '--dsw-surface-banner-notice', 'banner.notice')
})
check('B4 默认值全为 var(--dsw-*) 引用', () => {
  for (const s of truth.SURFACE_ENTRIES) assert(/^var\(--dsw-[a-z0-9-]+\)$/.test(s.default), `${s.key} default 非 var 引用: ${s.default}`)
})
check('B5 points 真实存在且含声明 var', () => {
  eq(truth.SURFACE_ENTRIES.reduce((n, s) => n + s.points.length, 0), 23, 'surface points 总数')
  for (const s of truth.SURFACE_ENTRIES) {
    for (const p of s.points) {
      const abs = resolve(ROOT, p.file)
      assert(existsSync(abs), `${s.key} point 文件不存在: ${p.file}`)
      const lines = readFileSync(abs, 'utf8').split('\n')
      assert(p.line >= 1 && p.line <= lines.length, `${s.key} point 行越界: ${p.file}:${p.line}`)
      const line = lines[p.line - 1]
      assert(line.includes('background'), `${s.key} point 非 background 行: ${p.file}:${p.line}`)
      const surfaceVar = `var(${s.emits})`
      assert(line.includes(`var(${p.use}`) || line.includes(surfaceVar), `${s.key} point 未吃 ${p.use} 也未改指 ${s.emits}: ${p.file}:${p.line} => ${line.trim()}`)
    }
  }
})

// ── §D tones 抽取 ────────────────────────────────────────────────────────
section('D')
check('D1 tones 模块 Node 可 import', () => {
  const tones = requireTs(resolve(ROOT, 'components/dsh-icon/dsh-icon.tones.ts'))
  eq(Object.keys(tones.TONE_SETS).length, 5, 'tone set count')
})
check('D2 resolveTone 五 Set 闭集语义不变', () => {
  const { resolveTone, TONE_SETS } = requireTs(resolve(ROOT, 'components/dsh-icon/dsh-icon.tones.ts'))
  assert(TONE_SETS.accent.has('check-outline'), 'accent 闭集')
  eq(resolveTone('check-outline', 'accent'), 'accent', 'accent known')
  eq(resolveTone('trash-outline', 'accent'), 'secondary', 'accent fallback')
  eq(resolveTone('stop-fill', 'inverse'), 'inverse', 'inverse known')
  eq(resolveTone('trash-outline', 'inverse'), 'primary', 'inverse fallback')
  eq(resolveTone('trash-outline', 'danger'), 'danger', 'danger known')
  eq(resolveTone('stop-fill', 'danger'), 'secondary', 'danger fallback')
  eq(resolveTone('warning-outline', 'warn'), 'warn', 'warn known')
  eq(resolveTone('stop-fill', 'warn'), 'danger', 'warn fallback')
  eq(resolveTone('check-circle-outline', 'success'), 'success', 'success known')
  eq(resolveTone('stop-fill', 'success'), 'secondary', 'success fallback')
})
check('D3 dsh-icon.ts 仅保留 import 引用', () => {
  const src = readFileSync(resolve(ROOT, 'components/dsh-icon/dsh-icon.ts'), 'utf8')
  assert(src.includes("from './dsh-icon.tones'"), 'dsh-icon.ts 未 import tones')
  assert(!src.includes('new Set(['), 'dsh-icon.ts 仍内联 Set')
})


// ── §C codegen 契约 ──────────────────────────────────────────────────────
section('C')
check('C1 五产物齐备', () => {
  for (const f of ['skin.gen.wxss', 'services/skin/vocab.ts', 'services/skin/palette-map.ts', 'assets/skins/dsh-default.json', 'theme.json']) {
    assert(existsSync(resolve(ROOT, f)), `缺产物 ${f}`)
  }
})
check('C2 skin.gen page = projected + surfaces + component vars / @media 55', () => {
  const css = readFileSync(resolve(ROOT, 'skin.gen.wxss'), 'utf8')
  const page = css.slice(css.indexOf('page {'), css.indexOf('@media'))
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  const componentVars = Object.values(vocab.components ?? {}).reduce((n, entry) => n + Object.keys(entry?.vars ?? {}).length, 0)
  eq((page.match(/^\s{2}--/gm) ?? []).length, Object.keys(vocab.tokens).length + Object.keys(vocab.surfaces).length + componentVars, 'light 键数')
  const dark = css.slice(css.indexOf('@media'))
  eq((dark.match(/^\s{4}--/gm) ?? []).length, 56, 'dark 键数')
})
check('C3 skin.gen 无 less 语法', () => {
  const css = readFileSync(resolve(ROOT, 'skin.gen.wxss'), 'utf8')
  assert(!/^\s*\/\//.test(css), '出现 // 注释')
  assert(!/@(?!media)/.test(css.replace(/@media/g, '')), '出现 less @ 语法')
  assert(!/&|\.mixin|@var/.test(css), '出现 less 嵌套/mixin/变量')
})
check('C4 vocab 137 token + 15 surface', () => {
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  eq(Object.keys(vocab.tokens).length, 137, 'vocab.tokens')
  eq(Object.keys(vocab.surfaces).length, 15, 'vocab.surfaces')
  assert(vocab.tokens['--bg'] === undefined, 'derived 不应进 vocab')
})
check('C6 dsh-default ↔ vocab 字段级跨产物对账（非 validate 自证）', () => {
  const def = JSON.parse(readFileSync(resolve(ROOT, 'assets/skins/dsh-default.json'), 'utf8'))
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  for (const mode of ['light', 'dark']) {
    for (const family of ['palette', 'shape', 'spacing', 'typography', 'elevation']) {
      for (const [key, value] of Object.entries(def[mode][family])) {
        assert(vocab.tokens[key] !== undefined, `${mode}.${family} 未知键 ${key}`)
        eq(value, vocab.tokens[key][mode], `${mode}.${family}.${key} 与 vocab 不一致`)
      }
    }
    for (const [key, value] of Object.entries(def[mode].surfaces)) {
      eq(value, vocab.surfaces[key].default, `${mode}.surfaces.${key} 与 vocab 不一致`)
    }
    for (const [key, value] of Object.entries(def[mode].chrome)) {
      eq(value, vocab.chrome[key][mode], `${mode}.chrome.${key} 与 vocab 不一致`)
    }
  }
})
check('C5 dsh-default 118 可写键 ×2 模式', () => {
  const def = JSON.parse(readFileSync(resolve(ROOT, 'assets/skins/dsh-default.json'), 'utf8'))
  const count = (block) => Object.entries(block).filter(([k]) => k !== 'chrome' && k !== 'surfaces').reduce((n, [, v]) => n + Object.keys(v).length, 0)
  eq(count(def.light), 121, 'light token keys')
  eq(count(def.dark), 121, 'dark token keys')
  eq(Object.keys(def.light.surfaces).length, 15, 'surface keys')
  eq(def.light.surfaces['chat.bubble-user'], 'var(--dsw-specific-bubble)', 'surface default')
})

// ── wx stub / engine loader ─────────────────────────────────────────────
function loadEngine({ theme = 'light', stored } = {}) {
  const calls = { nav: [], bg: [], themeHandlers: [] }
  globalThis.wx = {
    getSystemInfoSync: () => ({ theme }),
    getStorageSync: () => (stored === undefined ? '' : stored),
    setStorageSync: () => {},
    removeStorageSync: () => {},
    onThemeChange: (fn) => { calls.themeHandlers.push(fn) },
    offThemeChange: () => {},
    setNavigationBarColor: (arg) => { calls.nav.push(arg) },
    setBackgroundColor: (arg) => { calls.bg.push(arg) },
  }
  const mod = requireTs(resolve(ROOT, 'services/skin/engine.ts'))
  mod.init()
  return { ...mod, calls }
}

// ── §E resolveMode 矩阵 ─────────────────────────────────────────────────
section('E')
check('E1 resolveMode 分支矩阵', () => {
  for (const theme of ['light', 'dark']) {
    const { resolveMode } = loadEngine({ theme })
    eq(resolveMode('system'), theme, `system@${theme}`)
    eq(resolveMode('light'), 'light', 'light')
    eq(resolveMode('dark'), 'dark', 'dark')
  }
})
check('E2 init 从 storage 恢复 pref', () => {
  eq(loadEngine({ theme: 'dark', stored: 'light' }).engine.eff, 'light', 'stored light')
  eq(loadEngine({ theme: 'dark', stored: undefined }).engine.eff, 'dark', 'system dark')
})
check('E3 setPref 三档 + eff=req', () => {
  const e = loadEngine({ theme: 'light' })
  eq(e.setPref('dark'), 'dark', 'setPref dark')
  eq(e.engine.eff, 'dark', 'eff dark')
  eq(e.setPref('system'), 'light', 'setPref system')
  eq(e.setPref('light'), 'light', 'setPref light')
})
check('E4 resolved 全键 = 134+15', () => {
  const e = loadEngine()
  eq(Object.keys(e.engine.tokens).length, 152, 'resolved keys')
  eq(e.engine.tokens['--dsw-surface-chat-interface'], 'var(--dsw-alias-bg-base)', 'surface var 原样')
})

// ── §F composeAppStyle / buildMetricsVars ───────────────────────────────
section('F')
check('F1 compose 串序 skin 段 + metrics 段', () => {
  const e = loadEngine()
  const metrics = e.buildMetricsVars({ statusBarHeight: 20, navBarContentHeight: 44, capsuleInsetRight: 102, safeAreaBottom: 34 })
  eq(JSON.stringify(metrics), JSON.stringify(['--app-status-bar: 20px', '--app-nav-height: 64px', '--app-capsule-right: 102px', '--app-safe-bottom: 34px']), 'metrics 4 键')
  const style = e.composeAppStyle(metrics)
  const firstMetric = style.indexOf('--app-status-bar')
  const lastSkin = style.lastIndexOf('--dsw-')
  assert(lastSkin < firstMetric, 'metrics 段必须在 skin 段之后')
  eq((style.match(/--(?:dsw|ds)-[a-z0-9-]+:/g) ?? []).length, 152, 'skin 键数')
  eq((style.match(/--app-[a-z-]+:/g) ?? []).length, 4, 'metrics 键数')
})
check('F2 compose 命名空间不交/无重复', () => {
  const e = loadEngine()
  const style = e.composeAppStyle([])
  const keys = style.split('; ').map((part) => part.split(':')[0].trim()).filter(Boolean)
  eq(new Set(keys).size, keys.length, '重复键')
  assert(keys.every((k) => k.startsWith('--dsw-') || k.startsWith('--ds-')), '出现非 --dsw/--ds 键')
})

// ── §G validator 正负矩阵 ───────────────────────────────────────────────
section('G')
function loadValidate() {
  const v = requireTs(resolve(ROOT, 'services/skin/validate.ts'))
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  return { validate: v.validate, vocab }
}
function baseSkin(overrides = {}) {
  return { $schema: 'dsh-mini.skin.v1', slug: 'demo-skin', name: 'Demo', light: { palette: { '--dsw-alias-bg-base': '#ffffff' } }, ...overrides }
}
function expectRule(skin, rule) {
  const { validate, vocab } = loadValidate()
  const r = validate(skin, vocab)
  assert(!r.ok, `应拒绝（期望 ${rule}）`)
  assert(r.errors.some((e) => e.rule === rule), `未见 ${rule}; errors=${JSON.stringify(r.errors)}`)
}
check('G1 正例 dsh-default', () => {
  const { validate, vocab } = loadValidate()
  const def = JSON.parse(readFileSync(resolve(ROOT, 'assets/skins/dsh-default.json'), 'utf8'))
  const r = validate(def, vocab)
  eq(JSON.stringify(r.errors), '[]', 'dsh-default errors')
  assert(r.ok, 'dsh-default 应通过')
})
check('G2 缺 $schema', () => expectRule({ slug: 'demo-skin', name: 'Demo', light: {} }, 'L1.schema.version'))
check('G3 非法 slug（大写/前导 -/超长）', () => {
  expectRule(baseSkin({ slug: 'DemoSkin' }), 'L1.slug.format')
  expectRule(baseSkin({ slug: '-demo' }), 'L1.slug.format')
  expectRule(baseSkin({ slug: 'a' + 'b'.repeat(65) }), 'L1.slug.format')
})
check('G4 ModeBlock 0 块', () => expectRule({ $schema: 'dsh-mini.skin.v1', slug: 'demo-skin', name: 'Demo' }, 'L1.mode-block.missing'))
check('G5 非 string 值', () => expectRule(baseSkin({ light: { palette: { '--dsw-alias-bg-base': 123 } } }), 'L3.value.type'))
check('G6 未知键', () => expectRule(baseSkin({ light: { palette: { '--dsw-not-exist': '#fff' } } }), 'L2.unknown-key'))
check('G7 invariant 写', () => expectRule(baseSkin({ light: { palette: { '--dsw-alias-scrim-strong': '#fff' } } }), 'L2.invariant'))
check('G8 derived 写', () => expectRule(baseSkin({ light: { palette: { '--bg': '#fff' } } }), 'L2.derived'))
check('G9 dsh- 前缀盗用', () => expectRule(baseSkin({ slug: 'dsh-evil' }), 'L1.slug.reserved'))
check('G10 data: 注入', () => expectRule(baseSkin({ light: { palette: { '--dsw-alias-bg-base': 'data:image/png;base64,AAAA' } } }), 'L3.value.data-uri'))
check('G11 裸 base64 负载', () => expectRule(baseSkin({ light: { palette: { '--dsw-alias-bg-base': 'A'.repeat(48) } } }), 'L3.value.data-uri'))
check('G12 CSS 规则串注入', () => expectRule(baseSkin({ light: { palette: { '--dsw-alias-bg-base': '#fff; } .x { color: red' } } }), 'L3.value.css-injection'))
check('G13 url 非法端点', () => expectRule(baseSkin({ light: { surfaces: { 'chat-interface': 'url(http://evil.example/x.png)' } } }), 'L3.url.endpoint'))
check('G14', () => expectRule(baseSkin({ components: { 'not-a-component': {} } }), 'L4.components.unknown'))
check('G14-src', () => {
  const src = readFileSync(resolve(ROOT, 'services/skin/validate.ts'), 'utf8')
  eq((src.match(/L4\.components\.empty-registry/g) ?? []).length, 0, 'empty-registry 仍在源码里')
})
check('G15 fonts capability', () => expectRule(baseSkin({ fonts: [{ family: 'X', src: 'https://x/y.woff' }] }), 'L6.capability.unsupported'))
check('G16 sounds capability', () => expectRule(baseSkin({ sounds: { 'ui.tap': 'https://x/y.mp3' } }), 'L6.capability.unsupported'))
check('G17 lockMode capability', () => expectRule(baseSkin({ meta: { lockMode: 'lock' } }), 'L6.capability.unsupported'))
check('G18 dotted emits 非法（词表侧）', () => {
  const { validate } = loadValidate()
  const badVocab = {
    tokens: { '--dsw-alias-bg-base': { key: '--dsw-alias-bg-base', family: 'palette', domain: 'color', light: '#fff', dark: '#000', writable: true, invariant: false, derived: false } },
    surfaces: { 'chat.bubble-user': { key: 'chat.bubble-user', emits: '--dsw-surface-chat.bubble-user', default: 'var(--dsw-alias-bg-base)' } },
    components: {},
  }
  const r = validate(baseSkin(), badVocab)
  assert(!r.ok && r.errors.some((e) => e.rule === 'L5.surface.emits'), '未见 L5.surface.emits')
})
check('G19 合法 surface 值（var 引用）', () => {
  const { validate, vocab } = loadValidate()
  const r = validate(baseSkin({ light: { surfaces: { 'chat.bubble-user': 'var(--dsw-specific-bubble)' } } }), vocab)
  assert(r.ok, `合法 surface 被拒: ${JSON.stringify(r.errors)}`)
})
check('G22 伪 dsh-default 非空 fonts/sounds/lockMode 仍拒绝（E4）', () => {
  expectRule({ $schema: 'dsh-mini.skin.v1', slug: 'dsh-default', name: '伪默认', light: {}, fonts: [{ family: 'X', src: 'https://x/y.woff' }] }, 'L6.capability.unsupported')
  expectRule({ $schema: 'dsh-mini.skin.v1', slug: 'dsh-default', name: '伪默认', light: {}, sounds: { 'ui.tap': 'https://x/y.mp3' } }, 'L6.capability.unsupported')
  expectRule({ $schema: 'dsh-mini.skin.v1', slug: 'dsh-default', name: '伪默认', light: {}, meta: { lockMode: 'lock' } }, 'L6.capability.unsupported')
})
check('G23 跨族重复/错误族归属拒绝', () => {
  expectRule(baseSkin({ light: { palette: { '--dsw-alias-bg-base': '#fff' }, shape: { '--dsw-alias-bg-base': '#fff' } } }), 'L2.duplicate-key')
  expectRule(baseSkin({ light: { shape: { '--dsw-alias-label-primary': '#fff' } } }), 'L2.family-mismatch')
})
check('G24', () => {
  const { validate, vocab } = loadValidate()
  const ok = validate(baseSkin({ light: { effects: { '--dsw-blur-surface': 'blur(20px)' } } }), vocab)
  assert(ok.ok, `blur(20px) 被拒 ${JSON.stringify(ok.errors)}`)
  expectRule(baseSkin({ light: { effects: { '--dsw-blur-surface': 'blur(20px);color:red' } } }), 'L3.value.css-injection')
  expectRule(baseSkin({ light: { effects: { '--dsw-no-such-effect': 'blur(20px)' } } }), 'L2.unknown-key')
})
check('G21 url 仅限 surfaces/assets/fonts（palette 注入拒绝）', () => {
  expectRule(baseSkin({ light: { palette: { '--dsw-alias-bg-base': 'url(https://evil.example/x.png)' } } }), 'L3.url.domain')
})
check('G20 url https 合法', () => {
  const { validate, vocab } = loadValidate()
  const r = validate(baseSkin({ light: { surfaces: { 'chat-interface': 'url(https://dsh-mini.saobao.com/a/x.png)' } } }), vocab)
  assert(r.ok, `https url 被拒: ${JSON.stringify(r.errors)}`)
})


// ── §H-P4 退役残留（P4 阶段：调用点 0 / import 白名单） ──────────────────
section('H-P4')
function tsFiles(dir, out = []) {
  for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) tsFiles(rel, out)
    else if (e.name.endsWith('.ts')) out.push(rel)
  }
  return out
}
check('H1 theme.ts 调用表达式 0', () => {
  const names = new Set(['getTheme', 'setTheme', 'applyNavigationBar', 'watchSystemTheme', 'useSystemTheme'])
  const hits = []
  for (const file of tsFiles('app.ts'.includes('/') ? 'pages' : 'pages').concat(tsFiles('components'), tsFiles('services'), ['app.ts'])) {
    const src = readFileSync(resolve(ROOT, file), 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
    const walk = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
        if (file !== 'services/theme.ts') hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}:${node.expression.text}`)
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
  }
  eq(JSON.stringify(hits), '[]', 'theme.ts 调用表达式')
})
check('H2 services/theme import 白名单（仅 import 行允许，当前应为 0）', () => {
  const hits = []
  for (const file of tsFiles('pages').concat(tsFiles('components'), tsFiles('services'), ['app.ts'])) {
    const src = readFileSync(resolve(ROOT, file), 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && /(^|\/)services\/theme$/.test(stmt.moduleSpecifier.text)) {
        hits.push(`${file}:${sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1}`)
      }
    }
  }
  eq(JSON.stringify(hits), '[]', 'services/theme import 残留')
})
check('H3 三页 appStyle 均由 composeAppStyle 产', () => {
  for (const f of ['pages/settings/settings.ts', 'pages/models/models.ts', 'pages/workspace/workspace.ts']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8')
    assert(src.includes('engine.composeAppStyle(engine.buildMetricsVars('), `${f} 未接 composeAppStyle`)
    assert(!/appStyle:\s*\[/.test(src), `${f} 仍有自拼 appStyle 数组`)
  }
})

// ── §I markdown 收敛（T14） ──────────────────────────────────────────────
section('I')
function loadMarkdown() {
  loadEngine({ theme: 'light' })
  return requireTs(resolve(ROOT, 'services/markdown.ts'))
}
const MD_SAMPLE = [
  '# Title', '', 'para **bold** and `inline`', '', '> quote', '', '---', '',
  '[link](https://example.com)', '',
  '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '',
  '```js', 'const x = 1', '```', '',
].join('\n')
check('I1 light palette 11 字段值 = P0 基线', () => {
  const md = loadMarkdown()
  const engineMod = requireTs(resolve(ROOT, 'services/skin/engine.ts'))
  engineMod.setPref('light')
  const html = md.markdownToHtml(MD_SAMPLE)
  const base = baseline.nonLess.palette.light
  const expected = [base.text, base.secondary, base.tertiary, base.border, base.link, base.codeBg, base.codeBanner, base.codeText, base.inlineBg, base.tableHeadBg, base.tableRowAlt]
  for (const v of expected) {
    const needle = v.replace(/\s+/g, '').replace(/^rgba\(/, 'rgba(').toLowerCase()
    const hay = html.replace(/\s+/g, '').toLowerCase()
    assert(hay.includes(needle), `light palette 值未出现: ${v}`)
  }
})
check('I2 dark palette 11 字段值 = P0 基线', () => {
  const md = loadMarkdown()
  const engineMod = requireTs(resolve(ROOT, 'services/skin/engine.ts'))
  engineMod.setPref('dark')
  const html = md.markdownToHtml(MD_SAMPLE)
  const base = baseline.nonLess.palette.dark
  const expected = [base.text, base.secondary, base.tertiary, base.border, base.link, base.codeBg, base.codeBanner, base.codeText, base.inlineBg, base.tableHeadBg, base.tableRowAlt]
  const hay = html.replace(/\s+/g, '').toLowerCase()
  for (const v of expected) assert(hay.includes(v.replace(/\s+/g, '').toLowerCase()), `dark palette 值未出现: ${v}`)
})
check('I3 Menlo 三处取 --ds-font-family-code 值', () => {
  const md = loadMarkdown()
  const engineMod = requireTs(resolve(ROOT, 'services/skin/engine.ts'))
  engineMod.setPref('light')
  const html = md.markdownToHtml(MD_SAMPLE)
  const font = engineMod.engine.tokens['--ds-font-family-code']
  assert(html.includes(`font-family:${font};`), `未见 token 字体值: ${font}`)
  assert(!html.includes('Menlo,monospace'), '仍见 Menlo,monospace 字面量')
})
check('I4 源码无 palette 硬编码色表', () => {
  const src = readFileSync(resolve(ROOT, 'services/markdown.ts'), 'utf8')
  assert(!/return theme === 'dark'/.test(src), 'palette 双表仍在')
  assert(!/'#f9fafb'/.test(src), 'markdown.ts 仍有硬编码色值')
})

// ── §J 词表收口 + surfaces 改指（T16） ───────────────────────────────────
section('J')
function lessFiles() { return ['app.less', ...walkLess(resolve(ROOT, 'pages')), ...walkLess(resolve(ROOT, 'components'))].map((f) => relative(ROOT, f)) }
function walkLess(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    if (e.isDirectory()) walkLess(p, out)
    else if (e.name.endsWith('.less')) out.push(p)
  }
  return out
}
check('J1 旧悬空/旧名 key 零残留', () => {
  const bad = ['--dsw-alias-warning-primary', '--dsw-alias-positive-primary', '--dsw-shadow-lv3']
  for (const f of lessFiles()) {
    const src = readFileSync(resolve(ROOT, f), 'utf8')
    for (const key of bad) assert(!src.includes(key), `${f} 仍含 ${key}`)
  }
})
check('J2 2 新键去兜底直吃', () => {
  const ws = readFileSync(resolve(ROOT, 'pages/workspace/workspace.less'), 'utf8')
  assert(!ws.includes('var(--dsw-alias-bg-mask-3,'), 'workspace.bg-mask-3 仍有兜底')
  const mv = readFileSync(resolve(ROOT, 'components/markdown-view/markdown-view.less'), 'utf8')
  assert(!mv.includes('var(--dsw-alias-markdown-code-text,'), 'markdown-code-text 仍有兜底')
})
check('J3 derived 17 键四域零消费', () => {
  const derived = ['--bg', '--bg-elevated', '--bg-muted', '--text', '--text-secondary', '--text-tertiary', '--border', '--accent', '--accent-soft', '--danger', '--success', '--warn', '--user-bubble', '--user-text', '--assistant-bubble', '--shadow', '--radius']
  for (const f of lessFiles()) {
    if (f === 'app.less') continue // app.less 定义行（P5 删除）
    const src = readFileSync(resolve(ROOT, f), 'utf8')
    for (const key of derived) {
      const re = new RegExp(`var\\(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,)]`)
      assert(!re.test(src), `${f} 仍消费 derived ${key}`)
    }
  }
})
check('J4 15 键 points 全部改指 surface emits', () => {
  eq(truth.SURFACE_ENTRIES.reduce((n, s) => n + s.points.length, 0), 23, 'surface points 总数')
  for (const surface of truth.SURFACE_ENTRIES) {
    for (const p of surface.points) {
      const line = readFileSync(resolve(ROOT, p.file), 'utf8').split('\n')[p.line - 1]
      assert(line.includes(`var(${surface.emits})`), `${p.file}:${p.line} 未改指 ${surface.emits}`)
    }
  }
})
check('J5 非登记点保持 alias（防越界）', () => {
  const checks = [
    ['components/composer-bar/composer-bar.less', 44, '--dsw-alias-scrim-strong'],
    ['components/composer-bar/composer-bar.less', 129, '--dsw-alias-interactive-bg-hover'],
    ['components/right-panel/right-panel.less', 65, '--dsw-alias-interactive-bg-hover'],
    ['pages/workspace/workspace.less', 184, '--dsw-alias-interactive-bg-hover'],
  ]
  for (const [file, line, key] of checks) {
    const src = readFileSync(resolve(ROOT, file), 'utf8').split('\n')[line - 1]
    assert(src.includes(key), `${file}:${line} 非登记点被误改: ${src.trim()}`)
  }
})


// ── §H-P5 退役残留（P5 阶段：全零） ──────────────────────────────────────
section('H-P5')
function productFiles(exts) {
  const out = ['app.ts', 'app.less']
  const walk = (dir) => {
    for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel) }
      else if (exts.some((x) => e.name.endsWith(x))) out.push(rel)
    }
  }
  walk('pages'); walk('components'); walk('services'); walk('scripts')
  return out
}
check('H4 .theme-dark 注释剥离后全零', () => {
  for (const file of productFiles(['.less', '.ts', '.wxml'])) {
    const src = readFileSync(resolve(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert(!src.includes('.theme-dark'), `${file} 仍含 .theme-dark`)
  }
})
check('H5 theme-{{ 空格变体零残留', () => {
  for (const file of productFiles(['.wxml'])) {
    const src = readFileSync(resolve(ROOT, file), 'utf8')
    assert(!/theme-\s*\{\{/.test(src), `${file} 仍含 theme-{{`)
  }
})
check('H6 TS 拼接 theme-${ / theme- + 零残留', () => {
  for (const file of productFiles(['.ts'])) {
    const src = readFileSync(resolve(ROOT, file), 'utf8')
    assert(!/theme-\$\{/.test(src), `${file} 仍含 theme-\${`)
    assert(!/'theme-'\s*\+/.test(src), `${file} 仍含 'theme-' +`)
  }
})
check('H7 services/theme AST import 全零（含 import type）', () => {
  const hits = []
  for (const file of productFiles(['.ts'])) {
    const src = readFileSync(resolve(ROOT, file), 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && /(^|\/)services\/theme$/.test(stmt.moduleSpecifier.text)) {
        hits.push(`${file}:${sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1}`)
      }
    }
  }
  eq(JSON.stringify(hits), '[]', 'services/theme import')
})
check('H8 build-theme / 旧键 / dotted emits 零残留', () => {
  for (const file of productFiles(['.ts', '.mjs', '.less', '.json'])) {
    if (file === 'scripts/skin-equiv-check.mjs') continue // 等价核对器需引用旧名做映射，不属产品消费面
    const src = readFileSync(resolve(ROOT, file), 'utf8')
    for (const bad of ['build-theme', '--dsw-shadow-lv3', '--dsw-alias-warning-primary', '--dsw-alias-positive-primary']) {
      assert(!src.includes(bad), `${file} 仍含 ${bad}`)
    }
    assert(!/--dsw-surface-[a-z0-9-]+\./.test(src), `${file} 仍含 dotted surface emit`)
  }
})
check('H9 theme.ts/build-theme.mjs 物理删除', () => {
  assert(!existsSync(resolve(ROOT, 'services/theme.ts')), 'services/theme.ts 仍存在')
  assert(!existsSync(resolve(ROOT, 'scripts/build-theme.mjs')), 'scripts/build-theme.mjs 仍存在')
})


// ── §K fixture 双轨注入（T18） ───────────────────────────────────────────
section('K')
function fixture(name) {
  return JSON.parse(readFileSync(resolve(ROOT, `test/spike/mini-skin/fixtures/${name}`), 'utf8'))
}
check('K1 两 fixture 过 validate', () => {
  const { validate, vocab } = loadValidate()
  for (const name of ['skin-forest-light.json', 'skin-ink-night.json']) {
    const r = validate(fixture(name), vocab)
    assert(r.ok, `${name} 被拒: ${JSON.stringify(r.errors)}`)
  }
})
check('K2 forest-light applySkin 写键生效/未写键 defaults/键集闭集', () => {
  const e = loadEngine({ theme: 'light' })
  const forest = fixture('skin-forest-light.json')
  e.applySkin(forest)
  eq(e.engine.tokens['--dsw-alias-state-business-primary'], '#2f855a', 'accent 写键')
  eq(e.engine.tokens['--dsw-alias-bg-base'], '#ffffff', '未写键 defaults')
  eq(Object.keys(e.engine.tokens).length, 152, 'resolved 键集 ≡ vocab 键集')
  eq(e.engine.tokens['--dsw-surface-chat-interface'], '#f7fdf9', 'surface 写键')
})
check('K3 light-only 切 dark 回落 defaults[dark]（D12(a)）', () => {
  const e = loadEngine({ theme: 'light' })
  e.applySkin(fixture('skin-forest-light.json'))
  e.setPref('dark')
  eq(e.engine.eff, 'dark', 'eff=req')
  eq(e.engine.tokens['--dsw-alias-bg-base'], '#151517', 'dark 回落 defaults')
  eq(e.engine.tokens['--dsw-surface-chat-interface'], 'var(--dsw-alias-bg-base)', 'surface 回落默认引用')
  eq(e.engine.tokens['--dsw-alias-state-business-primary'], '#7aaaff', '写键仅 light 块，dark 回落默认')
})
check('K4 ink-night 双块覆写', () => {
  const e = loadEngine({ theme: 'light' })
  e.applySkin(fixture('skin-ink-night.json'))
  eq(e.engine.tokens['--dsw-alias-bg-base'], '#f5f7fa', 'light bg')
  eq(e.engine.tokens['--dsw-surface-sidebar'], 'var(--dsw-specific-sidebar-fill)', 'light 未写 surface 默认')
  e.setPref('dark')
  eq(e.engine.tokens['--dsw-alias-bg-base'], '#0b1020', 'dark bg')
  eq(e.engine.tokens['--dsw-alias-state-business-primary'], '#8fb8ff', 'dark accent')
  eq(e.engine.tokens['--dsw-surface-sidebar'], '#0e1526', 'dark surface')
})
check('K5 非法皮肤 applySkin 拒绝（fail-closed）', () => {
  const e = loadEngine({ theme: 'light' })
  let threw = false
  try {
    e.applySkin({ $schema: 'dsh-mini.skin.v1', slug: 'bad-skin', name: 'Bad', light: { palette: { '--dsw-nope': '#fff' } } })
  } catch (err) {
    threw = err instanceof Error && err.name === 'SkinValidationError' && Array.isArray(err.errors) && err.errors.some((x) => x.rule === 'L2.unknown-key')
  }
  assert(threw, '非法皮肤未抛 SkinValidationError/L2.unknown-key')
})
check('K7 skin 覆写 bg 时 setBackgroundColor 跟随 resolved bg', () => {
  const e = loadEngine({ theme: 'light' })
  e.applySkin({ $schema: 'dsh-mini.skin.v1', slug: 'bg-probe', name: 'BG Probe', light: { palette: { '--dsw-alias-bg-base': '#123456' } } })
  e.applyChrome('light', 'base')
  const bg = e.calls.bg[e.calls.bg.length - 1]
  eq(bg.backgroundColor, '#123456', 'backgroundColor')
  eq(bg.backgroundColorTop, '#123456', 'backgroundColorTop')
  eq(bg.backgroundColorBottom, '#123456', 'backgroundColorBottom')
})
check('K6 null 重置默认 + 伪 dsh-default 不得免检', () => {
  const e = loadEngine({ theme: 'light' })
  e.applySkin(fixture('skin-forest-light.json'))
  e.applySkin(null)
  eq(e.engine.tokens['--dsw-alias-state-business-primary'], '#4176e6', 'null 重置 defaults')
  let threw = false
  try {
    e.applySkin({ $schema: 'dsh-mini.skin.v1', slug: 'dsh-default', name: '伪默认', light: { palette: { '--dsw-nope': '#fff' } } })
  } catch (err) {
    threw = err instanceof Error && err.name === 'SkinValidationError'
  }
  assert(threw, '伪 dsh-default 绕过 validate')
})

// ── §M MS02 矩阵 / 台账（P0 起；不改产品计数） ───────────────────────────
section('M')
check('MS02-T01', () => {
  const text = readFileSync(resolve(ROOT, 'docs/truth/mini-skin/MS01-qna.md'), 'utf8')
  const lines = text.split('\n')
  const cell = lines[46] ?? ''
  assert(cell.includes('快径免检'), ':47 单元格不含快径免检')
  assert(!cell.includes('engine.ts:210-213'), ':47 混入了 engine.ts:210-213')
  assert(!cell.includes('伪 dsh-default'), ':47 混入了伪 dsh-default')
  const start = text.indexOf('## 11. 跨册补登记 MS01-R1')
  assert(start >= 0, '缺 §11 MS01-R1')
  const next = text.indexOf('\n## ', start + 4)
  const section11 = next === -1 ? text.slice(start) : text.slice(start, next)
  assert(section11.includes('engine.ts:210-213'), '§11 缺 engine.ts:210-213')
  assert(section11.includes('伪 `dsh-default`') || section11.includes('伪 dsh-default'), '§11 缺伪 dsh-default')
})
check('MS02-T02', () => {
  const ledger = JSON.parse(readFileSync(resolve(ROOT, 'test/spike/mini-skin/component-literal-ledger.json'), 'utf8'))
  const hard = { 32: '33.333vh', 49: '-44px', 56: '30px', 57: '30px' }
  const file = 'components/up-drawer/up-drawer.less'
  for (const [line, value] of Object.entries(hard)) {
    const row = ledger.declarations.find((d) => d.file === file && d.line === Number(line) && d.value === value)
    assert(row !== undefined, `台账缺 ${file}:${line} ${value}`)
  }
  execFileSync('git', ['merge-base', '--is-ancestor', ledger.headSha, 'HEAD'], { cwd: ROOT, stdio: 'ignore' })
  const shown = execFileSync('git', ['show', `${ledger.headSha}:${file}`], { cwd: ROOT, encoding: 'utf8' }).split('\n')
  for (const [line, value] of Object.entries(hard)) {
    assert((shown[Number(line) - 1] ?? '').includes(value), `git show ${line} 不含 ${value}`)
  }
  let code = 0
  try {
    execFileSync('node', ['test/spike/mini-skin/snapshot-literals.mjs'], { cwd: ROOT, stdio: 'ignore' })
  } catch (err) {
    code = err.status ?? 1
  }
  eq(code, 1, '第二次生成必须 exit 1')
})
check('MS02-T03', () => {
  const matrix = JSON.parse(readFileSync(resolve(ROOT, 'test/spike/mini-skin/component-matrix.json'), 'utf8'))
  const dirs = readdirSync(resolve(ROOT, 'components'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  const keys = Object.keys(matrix.rows).sort()
  eq(JSON.stringify(keys), JSON.stringify(dirs), '矩阵键集合 != 目录名')
  eq(matrix.rows['up-drawer'].verdict, 'full', 'up-drawer')
  eq(matrix.rows['trajectory-view'].verdict, 'empty-invariant', 'trajectory-view')
  eq(matrix.rows['markdown-view'].verdict, 'empty-service', 'markdown-view')
  eq(matrix.rows['dsh-icon'].verdict, 'empty-asset', 'dsh-icon')
  const frozen = new Set(['trajectory-view', 'markdown-view', 'dsh-icon'])
  const empties = []
  for (const [name, row] of Object.entries(matrix.rows)) {
    assert(row.verdict.length > 0, `${name} verdict 空`)
    const refs = [...row.verdictReason.matchAll(/@(\S+?):(\d+)/g)]
    assert(refs.length > 0, `${name} verdictReason 无 file:line`)
    for (const ref of refs) {
      const abs = resolve(ROOT, ref[1])
      assert(existsSync(abs), `${name} 证据文件不存在 ${ref[1]}`)
      const srcLines = readFileSync(abs, 'utf8').split('\n')
      const lineNo = Number(ref[2])
      assert(lineNo >= 1 && lineNo <= srcLines.length, `${name} 行越界 ${ref[1]}:${lineNo}`)
      assert((srcLines[lineNo - 1] ?? '').trim().length > 0, `${name} 证据行是空行 ${ref[1]}:${lineNo}`)
    }
    if (row.verdict === 'empty' && !frozen.has(name)) empties.push(row)
  }
  const seen = new Set()
  for (const row of empties) {
    const dumped = JSON.stringify(row.verdictReason)
    assert(!seen.has(dumped), '非特例 empty 的 verdictReason deep-equal')
    seen.add(dumped)
  }
})

function runNode(args) {
  try {
    const stdout = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout?.toString?.() ?? '', stderr: err.stderr?.toString?.() ?? '' }
  }
}

section('N')
check('MS02-T04', () => {
  const roots = ['skin', 'services', 'scripts', 'components']
  const hits = []
  function walk(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(abs)
      } else if (/\.(ts|mjs|js)$/.test(entry.name) && /\bComponentManifest\b/.test(readFileSync(abs, 'utf8'))) {
        hits.push(relative(ROOT, abs))
      }
    }
  }
  for (const r of roots) walk(resolve(ROOT, r))
  eq(hits.length, 0, `仍有 ComponentManifest: ${hits.join(',')}`)
  const tsc = execFileSync(resolve(ROOT, 'node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8' })
  eq(tsc, '', 'tsc 应无输出')
})
check('MS02-T05', () => {
  const dir = resolve(ROOT, 'components/ms02-probe')
  const file = resolve(dir, 'ms02-probe.contract.ts')
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, 'export default { contractVersion: "1.0.0" }\n')
  try {
    const first = runNode(['scripts/build-skin.mjs', '--check'])
    eq(first.status, 1, '缺 CONTRACT 必须 exit 1')
    assert(first.stderr.includes('缺 CONTRACT'), `stderr 不含缺 CONTRACT: ${first.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const second = runNode(['scripts/build-skin.mjs', '--check'])
  eq(second.status, 0, `删除探针后 --check 应恢复: ${second.stderr}\n${second.stdout.slice(0, 400)}`)
})
check('MS02-T06', () => {
  const css = readFileSync(resolve(ROOT, 'skin.gen.wxss'), 'utf8')
  const mediaAt = css.indexOf('@media (prefers-color-scheme: dark)')
  assert(mediaAt > 0, '缺 dark media')
  const page = css.slice(0, mediaAt)
  const dark = css.slice(mediaAt)
  const matrix = JSON.parse(readFileSync(resolve(ROOT, 'test/spike/mini-skin/component-matrix.json'), 'utf8'))
  let checked = 0
  for (const [name, row] of Object.entries(matrix.rows)) {
    const contract = resolve(ROOT, 'components', name, `${name}.contract.ts`)
    if (!existsSync(contract)) continue
    for (const token of row.consumedVars) {
      const needle = `  ${token}:`
      eq((page.match(new RegExp(`^${needle}`, 'gm')) ?? []).length, 1, `${token} page 次数`)
      eq((dark.match(new RegExp(`^${needle.replace('  ', '    ')}`, 'gm')) ?? []).length, 0, `${token} dark 次数`)
      assert(page.indexOf(needle) !== -1 && page.indexOf(needle) < mediaAt, `${token} 不在 dark 之前`)
      checked += 1
    }
  }
  if (checked === 0) assert(!css.includes('/* component-defaults */'), '0 份合约却插入了 component-defaults')
})
function probeVocab() {
  const { vocab } = loadValidate()
  return {
    ...vocab,
    components: {
      'up-drawer': {
        contractVersion: '1.0.0',
        layout: ['dock-bottom'],
        vars: {
          '--dsw-upd-height': { kind: 'length', units: ['vh'], default: '33.333vh' },
          '--dsw-upd-close-top': { kind: 'length', units: ['px'], default: '-44px' },
        },
        options: {},
        assets: { hero: 'image' },
      },
    },
  }
}
function rulesOf(skin, vocab) {
  const { validate } = loadValidate()
  return validate(skin, vocab ?? probeVocab())
}
check('MS02-T09', () => {
  const okEmpty = rulesOf(baseSkin({ components: {} }))
  assert(okEmpty.ok, `components {} 被拒 ${JSON.stringify(okEmpty.errors)}`)
  const okManifest = rulesOf(baseSkin({ components: { 'up-drawer': {} } }))
  assert(okManifest.ok, `已注册 {} 被拒 ${JSON.stringify(okManifest.errors)}`)
  const okVar = rulesOf(baseSkin({ components: { 'up-drawer': { vars: { '--dsw-upd-height': '40vh' } } } }))
  assert(okVar.ok, `40vh 被拒 ${JSON.stringify(okVar.errors)}`)
  const cases = [
    [baseSkin({ components: { 'nope': {} } }), 'L4.components.unknown'],
    [baseSkin({ components: { 'up-drawer': { vars: { '--dsw-nope': '1px' } } } }), 'L4.components.unknown-var'],
    [baseSkin({ components: { 'up-drawer': { vars: { '--dsw-upd-height': '20px' } } } }), 'L4.components.vars.unit'],
    [baseSkin({ components: { 'up-drawer': { layout: 'side-sheet' } } }), 'L4.components.layout.enum'],
    [baseSkin({ components: { 'up-drawer': { layout: 'dock-bottom extra' } } }), 'L4.components.layout.space'],
    [baseSkin({ components: { 'up-drawer': { layout: 'dock-bottom;' } } }), 'L4.components.layout.injection'],
    [baseSkin({ components: { 'up-drawer': { vars: { '--dsw-upd-height': '33.333vh; color:red' } } } }), 'L4.components.value.css-injection'],
    [baseSkin({ components: { 'up-drawer': { vars: { '--dsw-upd-height': 'data:text/plain,hi' } } } }), 'L4.components.value.data'],
    [baseSkin({ components: { 'up-drawer': { vars: { '--dsw-upd-height': 'expression(alert(1))' } } } }), 'L4.components.value.expression'],
    [baseSkin({ components: { 'up-drawer': { assets: { hero: 'http://evil.example/a.png' } } } }), 'L3.url.endpoint'],
  ]
  for (const [skin, rule] of cases) {
    const result = rulesOf(skin)
    assert(result.errors.some((e) => e.rule === rule), `${rule} 未命中 ${JSON.stringify(result.errors)}`)
  }
  const space = rulesOf(baseSkin({ components: { 'up-drawer': { layout: 'dock-bottom extra' } } }))
  assert(!space.errors.some((e) => e.rule === 'L4.components.layout.enum'), '带空格的 layout 误用了越枚举')
  const injected = rulesOf(baseSkin({ components: { 'up-drawer': { layout: 'dock-bottom;' } } }))
  assert(!injected.errors.some((e) => e.rule === 'L4.components.layout.enum'), '带分号的 layout 误用了越枚举')
  const evil = rulesOf(baseSkin({ components: { 'up-drawer': { assets: { hero: 'https://evil.example/a.png' } } } }))
  assert(!evil.errors.some((e) => /host/i.test(e.rule)), `出现了 host rule: ${JSON.stringify(evil.errors)}`)
  const versionField = rulesOf(baseSkin({ components: { 'up-drawer': { contractVersion: '9.9.9' } } }))
  assert(!versionField.errors.some((e) => e.rule === 'contractVersion' || e.rule.includes('contractVersion')), '不得产生 contractVersion rule')
})
check('MS02-T10', () => {
  const dir = resolve(ROOT, 'components/ms02-probe')
  const file = resolve(dir, 'ms02-probe.contract.ts')
  mkdirSync(dir, { recursive: true })
  try {
    for (const version of ['1.0', 'v1.0.0', '']) {
      writeFileSync(file, `export const CONTRACT = { contractVersion: ${JSON.stringify(version)} }\n`)
      const run = runNode(['scripts/build-skin.mjs', '--check'])
      const combined = `${run.stdout}\n${run.stderr}`
      eq(run.status, 1, `坏版本 ${version} 必须 exit 1`)
      assert(combined.includes('格式失配'), `坏版本 ${version} 文案不含格式失配: ${combined.slice(0, 500)}`)
      const report = JSON.parse(run.stdout)
      const blob = JSON.stringify(report.validate?.errors ?? [])
      assert(!blob.includes('contractVersion'), `validate errors 含 contractVersion: ${blob}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
check('MS02-T07', () => {
  const file = resolve(ROOT, 'assets/skins/dsh-default.json')
  const original = readFileSync(file, 'utf8')
  try {
    const planted = JSON.parse(original)
    planted.components = { planted: { layout: 'nope' } }
    writeFileSync(file, JSON.stringify(planted, null, 2) + '\n')
    const run = runNode(['scripts/build-skin.mjs', '--check'])
    const report = JSON.parse(run.stdout)
    assert(report.crossCheck.ok === false, '段 2 plant 未把 crossCheck.ok 打成 false')
    assert(report.crossCheck.errors.some((e) => e.includes('dsh-default.components')), `errors 未点名 dsh-default.components: ${JSON.stringify(report.crossCheck.errors)}`)
  } finally {
    writeFileSync(file, original)
  }
})

const MS02_BASE = '3dfda292892cf047d84dc49b6def2dd2c34304a9'
check('MS02-T11', () => {
  const bare = loadEngine()
  eq(bare.componentVars('up-drawer'), '', '未 apply 时 vars 必须是空串')
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  const previous = vocab.components
  vocab.components = {
    'up-drawer': {
      contractVersion: '1.0.0',
      layout: ['dock-bottom'],
      vars: {
        '--dsw-upd-height': { kind: 'length', units: ['vh'], default: '33.333vh' },
        '--dsw-upd-close-size': { kind: 'length', units: ['px'], default: '30px' },
      },
    },
  }
  try {
    const e = loadEngine()
    eq(e.componentVars('up-drawer'), '', '无覆写时不把 default 打进 inline')
    eq(e.componentLayout('up-drawer'), 'dock-bottom', '无覆写取 layout[0]')
    e.applySkin({
      $schema: 'dsh-mini.skin.v1', slug: 'probe-skin', name: 'Probe',
      components: { 'up-drawer': { vars: { '--dsw-upd-height': '40vh' } } },
      light: { palette: { '--dsw-alias-bg-base': '#ffffff' } },
    })
    const vars = e.componentVars('up-drawer')
    assert(vars.includes('--dsw-upd-height: 40vh'), `覆写未出现: ${vars}`)
    assert(!vars.includes('--dsw-upd-close-size'), `兄弟键漏进 inline: ${vars}`)
    vocab.components['up-drawer'].layout[0] = 'dock-side'
    e.applySkin(null)
    eq(e.componentLayout('up-drawer'), 'dock-side', 'layout[0] 改了必须跟着变')
    let calls = 0
    const unwatch = e.watchMode(() => { calls += 1 })
    e.applySkin(null)
    eq(calls, 1, '订阅后 applySkin 应回调')
    unwatch()
    e.applySkin(null)
    eq(calls, 1, '退订后 applySkin 不得再回调')
  } finally {
    vocab.components = previous
  }
})
check('MS02-T12', () => {
  const e = loadEngine()
  const style = e.composeAppStyle([])
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  for (const contract of Object.values(vocab.components)) {
    for (const key of Object.keys(contract?.vars ?? {})) assert(!style.includes(key), `composeAppStyle 掺了 ${key}`)
  }
  const storage = readFileSync(resolve(ROOT, 'services/storage.ts'), 'utf8').split('\n').slice(2, 12).join('\n')
  const keys = [...storage.matchAll(/'dsh:[^']+'/g)].map((m) => m[0])
  eq(JSON.stringify(keys), JSON.stringify([
    "'dsh:theme:v2'", "'dsh:last-session:v2'", "'dsh:sessions:v2'", "'dsh:model:v2'",
    "'dsh:byok-enrollment:v1'", "'dsh:permission:v1'", "'dsh:plan-mode:v1'", "'dsh:goal:v1'",
    "'dsh:feedback:v1'", "'dsh:feedback-ratings:v1'",
  ]), 'storage 键集合变了')
  const diff = execFileSync('git', ['diff', MS02_BASE, '--', 'services/storage.ts'], { cwd: ROOT, encoding: 'utf8' })
  eq(diff, '', 'storage.ts 相对 BASE 必须为空')
  const engineSrc = readFileSync(resolve(ROOT, 'services/skin/engine.ts'), 'utf8')
  assert(!engineSrc.includes('快径'), 'engine 仍写着快径')
})
check('MS02-T08', () => {
  const ok = runNode(['scripts/build-skin.mjs', '--check'])
  eq(ok.status, 0, `三元等号未成立: ${ok.stderr.slice(0, 500)}`)
  const report = JSON.parse(ok.stdout)
  eq(report.contractNames.disk.length, 23, 'disk')
  eq(JSON.stringify(report.contractNames.disk), JSON.stringify(report.contractNames.matrix), 'disk != matrix')
  eq(JSON.stringify(report.contractNames.matrix), JSON.stringify(report.contractNames.vocab), 'matrix != vocab')
  const dir = resolve(ROOT, 'components/ms02-probe')
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(resolve(dir, 'ms02-probe.contract.ts'), "export const CONTRACT = { contractVersion: '1.0.0' }\n")
    const extra = runNode(['scripts/build-skin.mjs', '--check'])
    eq(extra.status, 1, '多一份合同必须 exit 1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const matrixPath = resolve(ROOT, 'test/spike/mini-skin/component-matrix.json')
  const original = readFileSync(matrixPath, 'utf8')
  try {
    const planted = JSON.parse(original)
    planted.rows['ms02-missing'] = { verdict: 'empty', contractFile: '', verdictReason: 'plant' }
    writeFileSync(matrixPath, JSON.stringify(planted))
    const missing = runNode(['scripts/build-skin.mjs', '--check'])
    eq(missing.status, 1, '矩阵指向不存在的文件必须 exit 1')
  } finally {
    writeFileSync(matrixPath, original)
  }
})
check('MS02-T13', () => {
  const ledger = JSON.parse(readFileSync(resolve(ROOT, 'test/spike/mini-skin/component-literal-ledger.json'), 'utf8'))
  const matrix = JSON.parse(readFileSync(resolve(ROOT, 'test/spike/mini-skin/component-matrix.json'), 'utf8'))
  const contract = requireTs(resolve(ROOT, 'components/up-drawer/up-drawer.contract.ts')).CONTRACT
  eq(contract.vars['--dsw-upd-height'].default, '33.333vh', 'height')
  eq(contract.vars['--dsw-upd-close-top'].default, '-44px', 'top')
  eq(contract.vars['--dsw-upd-close-size'].default, '30px', 'size')
  const shown = execFileSync('git', ['show', `${MS02_BASE}:components/up-drawer/up-drawer.less`], { cwd: ROOT, encoding: 'utf8' }).split('\n')
  assert(shown[31].includes('33.333vh') && shown[48].includes('-44px') && shown[55].includes('30px') && shown[56].includes('30px'), 'git show 原行不等')
  const fallbacks = [
    ['components/up-drawer/up-drawer.less', 'var(--dsw-space-12, 12px)', 1],
    ['components/up-drawer/up-drawer.less', 'var(--dsw-radius-circle, 50%)', 1],
    ['components/up-drawer/up-drawer.less', 'var(--dsw-space-24, 24px)', 1],
    ['components/right-panel/right-panel.less', 'var(--app-nav-height, 0px)', 1],
    ['components/dsh-toast/dsh-toast.less', 'var(--app-nav-height, 0px)', 1],
    ['components/error-center/error-center.less', 'var(--app-nav-height, 0px)', 2],
    ['components/dsh-dialog/dsh-dialog.less', 'var(--app-nav-height, 0px)', 1],
    ['components/feedback-dialog/feedback-dialog.less', 'var(--app-nav-height, 0px)', 1],
    ['pages/workspace/workspace.less', 'var(--app-nav-height, 64px)', 2],
    ['pages/settings/settings.less', 'var(--app-status-bar, 0px)', 3],
  ]
  let fallbackCount = 0
  for (const [file, needle, count] of fallbacks) {
    const n = readFileSync(resolve(ROOT, file), 'utf8').split(needle).length - 1
    eq(n, count, `${file} ${needle}`)
    fallbackCount += count
  }
  eq(fallbackCount, 14, '14 处 fallback')
  const byPos = new Map()
  for (const row of Object.values(matrix.rows)) {
    for (const lit of row.skinDomainLiterals) byPos.set(`${lit.file}:${lit.line}:${lit.prop}`, lit)
  }
  const scanned = new Map()
  for (const decl of ledger.declarations) {
    if (!scanned.has(decl.file)) scanned.set(decl.file, scanLessDecls(resolve(ROOT, decl.file), ROOT))
    const current = scanned.get(decl.file).find((d) => d.line === decl.line && d.prop === decl.prop)
    assert(current !== undefined, `扫描丢了 ${decl.file}:${decl.line} ${decl.prop}`)
    if (current.value === decl.value) continue
    if (current.value === 'var(--dsw-blur-surface)' && decl.value === 'blur(20px)') continue
    const lit = byPos.get(`${decl.file}:${decl.line}:${decl.prop}`)
    assert(lit !== undefined, `未进合同的声明被改了 ${decl.file}:${decl.line} ${decl.prop}`)
    eq(current.value, `var(${lit.token})`, `改写不是无兜底 var ${decl.file}:${decl.line}`)
  }
})
check('MS02-T14', () => {
  const wxml = readFileSync(resolve(ROOT, 'components/up-drawer/up-drawer.wxml'), 'utf8')
  const tags = wxml.split('<view').slice(1).map((part) => part.slice(0, part.indexOf('>')))
  const mask = tags.find((tag) => tag.includes('upd-mask'))
  const sheet = tags.find((tag) => tag.includes('upd-sheet'))
  assert(mask !== undefined && !mask.includes('shellVars'), 'mask 被绑了 shellVars')
  assert(sheet !== undefined && sheet.includes('shellVars') && sheet.includes('layout-{{layout}}'), 'sheet 未接线')
  const sf = ts.createSourceFile('up-drawer.ts', readFileSync(resolve(ROOT, 'components/up-drawer/up-drawer.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  let attached = null
  let detached = null
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(sf) === 'attached') attached = node
    if (ts.isMethodDeclaration(node) && node.name.getText(sf) === 'detached') detached = node
    ts.forEachChild(node, visit)
  }
  visit(sf)
  assert(attached !== null && attached.getText(sf).includes('.watchMode('), 'attached 没有订阅')
  assert(detached !== null, '缺 detached')
  const detachedText = detached.getText(sf)
  assert(detachedText.includes('_unwatchSkin'), 'detached 没有退订')
  assert(detachedText.indexOf('_unwatchSkin') < detachedText.indexOf('clearTimeout'), '退订必须先于清 timer')
})
check('MS02-T21', () => {
  const files = [
    'components/dsh-menu/dsh-menu.less',
    'components/model-picker/model-picker.less',
    'components/command-menu/command-menu.less',
  ]
  let n = 0
  for (const file of files) {
    const text = readFileSync(resolve(ROOT, file), 'utf8')
    assert(!text.includes('blur(20px)'), `${file} 仍有裸 blur(20px)`)
    n += (text.match(/var\(--dsw-blur-surface\)/g) ?? []).length
    assert(!text.includes('var(--dsw-blur-surface,'), `${file} 写了 fallback`)
  }
  eq(n, 6, '六处 blur var')
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  eq(vocab.tokens['--dsw-blur-surface'].light, 'blur(20px)', 'light')
  eq(vocab.tokens['--dsw-blur-surface'].dark, 'blur(20px)', 'dark')
  const equiv = readFileSync(resolve(ROOT, 'scripts/skin-equiv-check.mjs'), 'utf8')
  assert(equiv.includes("'--dsw-blur-surface'"), 'expectedNew 未登记 blur')
})
check('MS02-T22', () => {
  const vocab = requireTs(resolve(ROOT, 'services/skin/vocab.ts')).VOCAB
  const map = requireTs(resolve(ROOT, 'services/skin/palette-map.ts')).PALETTE_MAP
  assert(map.tertiary.token === '--dsw-alias-markdown-tertiary', 'tertiary 仍是 literal')
  assert(map.tableRowAlt.token === '--dsw-alias-markdown-table-row-alt', 'tableRowAlt 仍是 literal')
  assert(map.tertiary.literal === undefined && map.tableRowAlt.literal === undefined, 'literal 分支还在')
  eq(vocab.tokens['--dsw-alias-markdown-tertiary'].light, '#81858c', 'tertiary light')
  eq(vocab.tokens['--dsw-alias-markdown-tertiary'].dark, '#81858c', 'tertiary dark')
  eq(vocab.tokens['--dsw-alias-markdown-table-row-alt'].light, 'rgba(0,0,0,0.02)', 'row light')
  eq(vocab.tokens['--dsw-alias-markdown-table-row-alt'].dark, 'rgba(255,255,255,0.03)', 'row dark')
  eq(vocab.tokens['--dsw-alias-label-tertiary'].dark, '#adb2b8', 'label-tertiary dark')
  assert(vocab.tokens['--dsw-alias-markdown-tertiary'].dark !== vocab.tokens['--dsw-alias-label-tertiary'].dark, '借了 label-tertiary')
})
check('MS02-T15', () => {
  const src = readFileSync(resolve(ROOT, 'test/spike/mini-skin/node-checks.mjs'), 'utf8')
  assert(src.includes("check('G14'"), '缺 G14 注册')
  assert(src.includes("check('G14-src'"), '缺 G14-src 注册')
  assert(src.includes('REQUIRED_IDS'), '缺 REQUIRED_IDS')
})

// ── 输出 ─────────────────────────────────────────────────────────────────
const json = process.argv.includes('--json')
const failed = results.filter((r) => !r.ok)
if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, pass: results.length - failed.length, fail: failed.length, results }, null, 2))
} else {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.section}] ${r.id}${r.ok ? '' : ' :: ' + r.error}`)
  console.log(`\n${results.length - failed.length}/${results.length} PASS`)
}
const REQUIRED_IDS = ['G14', 'G14-src']
const missingIds = REQUIRED_IDS.filter((id) => !results.some((r) => r.id === id))
if (missingIds.length > 0) {
  console.error(`MISSING required check id: ${missingIds.join(',')}`)
  process.exit(1)
}
process.exit(failed.length === 0 ? 0 : 1)
