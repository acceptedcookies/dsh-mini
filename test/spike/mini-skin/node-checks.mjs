#!/usr/bin/env node
/**
 * node-checks.mjs — MS01 静态/纯函数短验（test/spike/mini-skin 宪章下）
 * 用法: node test/spike/mini-skin/node-checks.mjs [--section A,B,D] [--json]
 * 退出: 0 = 全 PASS；1 = 有 FAIL；2 = 运行错误
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

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
    throw new Error(`node-checks 不支持外部依赖: ${spec}`)
  }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(mod.exports, req, mod, file, dir)
  return mod.exports
}
const truth = requireTs(resolve(ROOT, 'skin/truth/index.ts'))
const baseline = JSON.parse(readFileSync(resolve(ROOT, '.anote/ms01-baseline/resolved-values.json'), 'utf8'))

// ── §A 真源计数/元数据自洽 ───────────────────────────────────────────────
section('A')
check('A1 entries==151', () => eq(truth.ALL_TOKEN_ENTRIES.length, 151, 'ALL_TOKEN_ENTRIES.length'))
check('A2 projected==134', () => eq(truth.PROJECTED_ENTRIES.length, 134, 'PROJECTED_ENTRIES.length'))
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
    if (!e.key.startsWith('--dsw-alias-bg-mask-3') && !e.key.startsWith('--dsw-alias-markdown-code-text')) {
      assert(/^app\.less:\d+$/.test(e.source), `${e.key} source 非 app.less:NN: ${e.source}`)
    }
  }
})
check('A8 149 旧键 light/dark 与基线逐键一致', () => {
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
  eq(by.palette, 87, 'palette')
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
  for (const s of truth.SURFACE_ENTRIES) {
    for (const p of s.points) {
      const abs = resolve(ROOT, p.file)
      assert(existsSync(abs), `${s.key} point 文件不存在: ${p.file}`)
      const lines = readFileSync(abs, 'utf8').split('\n')
      assert(p.line >= 1 && p.line <= lines.length, `${s.key} point 行越界: ${p.file}:${p.line}`)
      const line = lines[p.line - 1]
      assert(line.includes('background'), `${s.key} point 非 background 行: ${p.file}:${p.line}`)
      assert(line.includes(`var(${p.use}`), `${s.key} point 未吃 ${p.use}: ${p.file}:${p.line} => ${line.trim()}`)
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

// ── 输出 ─────────────────────────────────────────────────────────────────
const json = process.argv.includes('--json')
const failed = results.filter((r) => !r.ok)
if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, pass: results.length - failed.length, fail: failed.length, results }, null, 2))
} else {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.section}] ${r.id}${r.ok ? '' : ' :: ' + r.error}`)
  console.log(`\n${results.length - failed.length}/${results.length} PASS`)
}
process.exit(failed.length === 0 ? 0 : 1)
