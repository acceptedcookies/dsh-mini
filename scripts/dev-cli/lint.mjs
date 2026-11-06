// dev-cli · 锚点覆盖检出（T-O-7）：wxml 交互绑定 × anchors.json 双向对账。
//   未锚     = 交互元素无 data-anchor 且无豁免（一级交互，必锚）
//   烂锚     = anchors.json 注册行在声明 page 文件中无 data-anchor 命中
//   未注册锚 = DOM 有 data-anchor 但注册表无名（注册表是唯一真源）
//   存活率   = anchored / (anchored + unanchored)
//
// 用法:
//   node scripts/dev-cli/lint.mjs           三段报告 + exit code（未锚/烂锚/未注册>0 → 1）
//   node scripts/dev-cli/lint.mjs --json    机器可读全量
//   import { lintAnchors } from './lint.mjs'  测试复用（test/mn04/lint.mjs）
//
// 提取全语法（审查 B·H1 反例）：(bind|catch|mut-bind|capture-bind|capture-catch) 的
//   无分隔（bindtap）与冒号分隔（bind:tap）双形态 + scroll 族（bindscroll*）。
// 豁免规则（T-O-7 三级视觉交互）：
//   - data-anchor-exempt 属性（显式声明：fold/image-preview/noop/component-internal/gesture-shield）
//   - handler ∈ EXEMPT_HANDLERS（noop 透传等）
//   - scroll 族绑定（bindscroll/bindscrolltolower/bindscrolltoupper）
//   - 组件 tag（含 -）只计 tap 族手势；其余 bind:* 为组件自定义事件，不计交互面
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO_ROOT } from './lib/args.mjs'
import { parseArgs } from './lib/args.mjs'

export const ANCHORS_PATH = join(REPO_ROOT, 'scripts/dev-cli/anchors.json')
export const SCAN_DIRS = ['pages', 'components']

const BIND_RE = /^(mut-bind|capture-bind|capture-catch|bind|catch)(:?)([a-zA-Z]+)$/
const SCROLL_FAMILY = new Set(['scroll', 'scrolltolower', 'scrolltoupper', 'scrollrefresher'])
const TAP_FAMILY = new Set(['tap', 'longpress', 'longtap', 'touchstart', 'touchmove', 'touchend', 'touchcancel'])
const EXEMPT_HANDLERS = new Set(['noop'])
const BUILTIN_TAGS = new Set([
  'view', 'text', 'input', 'textarea', 'image', 'scroll-view', 'button', 'navigator',
  'swiper', 'swiper-item', 'movable-view', 'movable-area', 'canvas', 'video', 'map',
  'picker', 'picker-view', 'picker-view-column', 'switch', 'slider', 'checkbox',
  'checkbox-group', 'radio', 'radio-group', 'form', 'label', 'editor', 'rich-text',
  'cover-view', 'cover-image', 'match-media', 'page-container', 'share-element',
  'keyboard-accessory', 'root-portal', 'block',
])

function* walkWxml(dir) {
  let names
  try { names = readdirSync(dir) } catch { return }
  for (const name of names) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walkWxml(p)
    else if (name.endsWith('.wxml')) yield p
  }
}

/** 单个 wxml 文件 → 交互/锚点元素清单。 */
export function scanWxml(file) {
  const src = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const rel = relative(REPO_ROOT, file)
  const els = []
  const tagRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  while ((m = tagRe.exec(src)) !== null) {
    const [, tag, attrSrc] = m
    const line = src.slice(0, m.index).split('\n').length
    const attrs = {}
    const attrRe = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
    let am
    while ((am = attrRe.exec(attrSrc)) !== null) {
      attrs[am[1]] = am[2] ?? am[3] ?? true
    }
    const anchor = attrs['data-anchor']
    const exemptAttr = attrs['data-anchor-exempt']
    const bindings = []
    for (const [k, v] of Object.entries(attrs)) {
      const bm = BIND_RE.exec(k)
      if (!bm) continue
      const event = bm[3].toLowerCase()
      bindings.push({ attr: k, event, handler: v === true ? '' : String(v) })
    }
    const isComponent = !BUILTIN_TAGS.has(tag) && tag.includes('-')
    const gestures = bindings.filter((b) =>
      isComponent ? TAP_FAMILY.has(b.event) : true)
    els.push({ file: rel, line, tag, anchor: typeof anchor === 'string' ? anchor : undefined, exemptAttr: typeof exemptAttr === 'string' ? exemptAttr : undefined, bindings, gestures })
  }
  return els
}

/** 元素判定：anchored（带锚） / exempt（豁免） / unanchored（未锚一级交互）。 */
export function classify(el) {
  if (el.anchor) return 'anchored'
  if (el.exemptAttr) return 'exempt'
  const flagged = el.gestures.filter(
    (g) => !SCROLL_FAMILY.has(g.event) && !EXEMPT_HANDLERS.has(g.handler)
  )
  return flagged.length === 0 ? 'exempt' : 'unanchored'
}

export function lintAnchors({ anchorsPath = ANCHORS_PATH, root = REPO_ROOT } = {}) {
  const reg = JSON.parse(readFileSync(anchorsPath, 'utf8'))
  const anchors = reg.anchors ?? reg
  const files = []
  for (const d of SCAN_DIRS) files.push(...walkWxml(join(root, d)))

  const elements = []
  const anchoredNames = new Map() // name -> [file:line]
  for (const f of files) {
    for (const el of scanWxml(f)) {
      const verdict = classify(el)
      elements.push({ ...el, verdict })
      if (el.anchor) {
        const list = anchoredNames.get(el.anchor) ?? []
        list.push(`${el.file}:${el.line}`)
        anchoredNames.set(el.anchor, list)
      }
    }
  }

  const unanchored = elements.filter((e) => e.verdict === 'unanchored')
  const exempt = elements.filter((e) => e.verdict === 'exempt' && (e.bindings.length || e.exemptAttr))
  const anchored = elements.filter((e) => e.verdict === 'anchored')

  // 烂锚：注册行声明的 page 文件中无 data-anchor 命中
  const stale = []
  for (const [name, meta] of Object.entries(anchors)) {
    const hit = anchoredNames.get(name) ?? []
    const inPage = meta.page ? hit.filter((h) => h.startsWith(meta.page + ':')) : hit
    if (inPage.length === 0) stale.push({ name, page: meta.page, domHits: hit })
  }

  // 未注册锚：DOM 有锚但注册表无名
  const unregistered = [...anchoredNames.keys()].filter((n) => !(n in anchors))

  const coverage = anchored.length + unanchored.length === 0
    ? 1
    : anchored.length / (anchored.length + unanchored.length)

  return {
    files: files.map((f) => relative(root, f)),
    counts: {
      elements: elements.length,
      anchored: anchored.length,
      unanchored: unanchored.length,
      exempt: exempt.length,
      registry: Object.keys(anchors).length,
      stale: stale.length,
      unregistered: unregistered.length,
      coverage,
    },
    unanchored: unanchored.map((e) => `${e.file}:${e.line} <${e.tag}> ${e.gestures.map((g) => `${g.attr}="${g.handler}"`).join(' ')}`),
    stale,
    unregistered: unregistered.map((n) => `${n} @ ${(anchoredNames.get(n) ?? []).join(', ')}`),
    exempt: exempt.map((e) => `${e.file}:${e.line} <${e.tag}> ${e.exemptAttr ?? e.bindings.map((b) => b.handler).join(',')}`),
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const { flags } = parseArgs()
  const r = lintAnchors()
  if (flags.json === true) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(`[lint] 扫描 ${r.files.length} wxml · 元素 ${r.counts.elements} · 注册 ${r.counts.registry}`)
    console.log(`\n── 未锚交互 (${r.counts.unanchored}) ──`)
    for (const u of r.unanchored) console.log(`  ${u}`)
    console.log(`\n── 烂锚 (${r.counts.stale}) ──`)
    for (const s of r.stale) console.log(`  ${s.name} → ${s.page}（DOM 命中 ${s.domHits.length}）`)
    console.log(`\n── 未注册锚 (${r.counts.unregistered}) ──`)
    for (const u of r.unregistered) console.log(`  ${u}`)
    console.log(`\n── 豁免 (${r.counts.exempt}) ──`)
    for (const e of r.exempt) console.log(`  ${e}`)
    console.log(`\n存活率: ${(r.counts.coverage * 100).toFixed(1)}%（${r.counts.anchored}/${r.counts.anchored + r.counts.unanchored}）`)
  }
  process.exit(r.counts.unanchored > 0 || r.counts.stale > 0 || r.counts.unregistered > 0 ? 1 : 0)
}
