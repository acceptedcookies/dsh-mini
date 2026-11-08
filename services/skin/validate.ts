/**
 * validate.ts — 皮肤 JSON validator（T-O-10 / MS01-E4）
 *
 * 纯函数：`validate(skinJson, vocab) → { ok, errors[] }`；错误 `{path, rule, message}`，
 * L1–L6 每层独立收集、不短路（fail-closed）。
 *
 * L1 schema / L2 词表 / L3 值域 / L4 components 三段判 / L5 引用完整性 / L6 capability。
 */
export interface ValidationError {
  path: string
  rule: string
  message: string
}

export interface ValidateResult {
  ok: boolean
  errors: ValidationError[]
}

export interface VocabTokenLike {
  key: string
  family: string
  domain: string
  light: string
  dark: string
  writable: boolean
  invariant: boolean
  derived: boolean
  linkedWith?: string[]
}

export interface VocabSurfaceLike {
  key: string
  emits: string
  default: string
  points?: Array<{ file: string; line: number; use: string }>
}

export interface VocabLike {
  tokens: Record<string, VocabTokenLike>
  surfaces: Record<string, VocabSurfaceLike>
  sounds?: string[]
  assets?: string[]
  chrome?: Record<string, { light: string; dark: string }>
  components?: Record<string, unknown>
  derivedKeys?: string[]
}

export type ModeBlock = Record<string, unknown>

export interface SkinJson {
  $schema?: unknown
  slug?: unknown
  name?: unknown
  meta?: unknown
  fonts?: unknown
  sounds?: unknown
  components?: unknown
  light?: unknown
  dark?: unknown
  [key: string]: unknown
}

const TOP_LEVEL_KEYS = new Set(['$schema', 'slug', 'name', 'meta', 'fonts', 'sounds', 'components', 'light', 'dark'])
const MODE_FAMILIES = new Set(['palette', 'surfaces', 'shape', 'spacing', 'typography', 'assets', 'elevation', 'effects', 'chrome'])
const CHROME_KEYS = new Set(['navBackground', 'navFront', 'pullBackground'])
const EFFECT_KEYS = new Set(['--dsw-blur-surface'])
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const SURFACE_KEY_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SURFACE_EMIT_RE = /^--dsw-surface-[a-z0-9]+(?:-[a-z0-9]+)*$/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
    || /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/i.test(value)
    || /^var\(--dsw-[a-z0-9-]+\)$/.test(value)
}

function isGradient(value: string): boolean {
  return /^(?:repeating-)?(?:linear|radial|conic)-gradient\([^;{}]*\)$/i.test(value)
}

function isLength(value: string): boolean {
  return /^(?:0|-?(?:\d+|\d*\.\d+)(?:px|em|rem|%|vh|vw|s|ms))$/.test(value)
    || /^var\(--dsw-[a-z0-9-]+\)$/.test(value)
}

function hasCssInjection(value: string): boolean {
  return /[;{}]/.test(value) || /@import/i.test(value) || /expression\s*\(/i.test(value) || /javascript:/i.test(value)
}

function hasDataPayload(value: string): boolean {
  return /data:/i.test(value) || /base64/i.test(value) || /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value.trim())
}

function urlsOf(value: string): string[] {
  const out: string[] = []
  const re = /url\(([^)]*)\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) out.push((m[1] ?? '').trim().replace(/^['"]|['"]$/g, ''))
  return out
}

function checkUrlEndpoints(path: string, value: string, errors: ValidationError[]): void {
  for (const url of urlsOf(value)) {
    if (!/^https:\/\/[^\s'")]+$/.test(url)) {
      errors.push({ path, rule: 'L3.url.endpoint', message: `url() 仅允许 https 绝对端点: ${url}` })
    }
  }
}

function checkValueDomain(path: string, family: string, domain: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value !== 'string') {
    errors.push({ path, rule: 'L3.value.type', message: `值必须是字符串（实际 ${typeof value}）` })
    return
  }
  if (value.trim().length === 0) {
    errors.push({ path, rule: 'L3.value.empty', message: '值不能为空字符串' })
    return
  }
  if (hasDataPayload(value)) {
    errors.push({ path, rule: 'L3.value.data-uri', message: `禁止 data:/base64 负载: ${value}` })
    return
  }
  if (hasCssInjection(value)) {
    errors.push({ path, rule: 'L3.value.css-injection', message: `禁止 CSS 规则串/注入字符: ${value}` })
    return
  }
  checkUrlEndpoints(path, value, errors)
  if (urlsOf(value).length > 0) {
    if (urlsOf(value).length > 3) errors.push({ path, rule: 'L3.url.nesting', message: 'url() 最多 3 层' })
    return
  }
  switch (domain) {
    case 'color':
      if (!isColor(value)) errors.push({ path, rule: 'L3.value.color', message: `非法颜色值: ${value}` })
      break
    case 'length':
    case 'tracking':
      if (!isLength(value)) errors.push({ path, rule: 'L3.value.length', message: `非法长度值: ${value}` })
      break
    case 'url':
      if (!/^https:\/\/[^\s'\")]+$/.test(value)) errors.push({ path, rule: 'L3.value.url', message: `非法 url 值: ${value}` })
      break
    case 'font-weight':
      if (!/^(?:normal|bold|[1-9]00|(?:1[0-9]|[2-9][0-9])0)$/.test(value)) errors.push({ path, rule: 'L3.value.font-weight', message: `非法字重: ${value}` })
      break
    case 'family-string':
      if (!/^[A-Za-z0-9"',\s-]+$/.test(value)) errors.push({ path, rule: 'L3.value.family', message: `非法字体族: ${value}` })
      break
    case 'shadow':
    case 'filter':
    case 'background-shorthand':
      if (!isColor(value) && !isGradient(value) && !/^(?:blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)\(/.test(value) && !/\b(?:rgba?|hsla?)\(/.test(value)) {
        errors.push({ path, rule: 'L3.value.shorthand', message: `非法 ${domain} 值: ${value}` })
      }
      break
    case 'derived-reference':
      break
    default:
      if (!isColor(value)) errors.push({ path, rule: 'L3.value.unknown-domain', message: `未知值域: ${domain}` })
  }
  if (family === 'surfaces' && !isColor(value) && !isGradient(value)) {
    errors.push({ path, rule: 'L3.surface.value', message: `surface 值仅允许颜色/渐变/url/https var: ${value}` })
  }
}

function push(errors: ValidationError[], path: string, rule: string, message: string): void {
  errors.push({ path, rule, message })
}

export function validate(skinJson: unknown, vocab: VocabLike): ValidateResult {
  const errors: ValidationError[] = []
  if (!isObject(skinJson)) {
    return { ok: false, errors: [{ path: '$', rule: 'L1.root.type', message: '皮肤必须是 JSON 对象' }] }
  }
  const skin = skinJson as SkinJson

  // L1 schema
  for (const key of Object.keys(skin)) {
    if (!TOP_LEVEL_KEYS.has(key)) push(errors, `$.${key}`, 'L2.unknown-key', `未知顶层键: ${key}`)
  }
  if (skin.$schema !== 'dsh-mini.skin.v1') {
    push(errors, '$.$schema', 'L1.schema.version', `$schema 必须为 dsh-mini.skin.v1（实际 ${String(skin.$schema)}）`)
  }
  if (typeof skin.slug !== 'string' || !SLUG_RE.test(skin.slug)) {
    push(errors, '$.slug', 'L1.slug.format', `slug 非法: ${String(skin.slug)}`)
  } else if (skin.slug.startsWith('dsh-') && skin.slug !== 'dsh-default') {
    push(errors, '$.slug', 'L1.slug.reserved', `dsh- 前缀保留给内置皮肤: ${skin.slug}`)
  }
  if (typeof skin.name !== 'string' || skin.name.trim().length === 0 || skin.name.length > 64) {
    push(errors, '$.name', 'L1.name', 'name 必须为非空字符串（≤64）')
  }
  const hasLight = isObject(skin.light)
  const hasDark = isObject(skin.dark)
  if (!hasLight && !hasDark) push(errors, '$.light', 'L1.mode-block.missing', 'light/dark 至少提供一个 ModeBlock')
  for (const mode of ['light', 'dark']) {
    if (skin[mode] !== undefined && !isObject(skin[mode])) push(errors, `$.${mode}`, 'L1.mode-block.type', `${mode} 必须是对象`)
  }

  // L2 词表 + L3 值域
  for (const mode of ['light', 'dark']) {
    const block = skin[mode]
    if (!isObject(block)) continue
    for (const family of Object.keys(block)) {
      if (!MODE_FAMILIES.has(family)) {
        push(errors, `$.${mode}.${family}`, 'L2.unknown-family', `未知 mode 族: ${family}`)
        continue
      }
      const familyBlock = block[family]
      if (!isObject(familyBlock)) {
        push(errors, `$.${mode}.${family}`, 'L2.family.type', `${family} 必须是对象`)
        continue
      }
      for (const [key, value] of Object.entries(familyBlock)) {
        const path = `$.${mode}.${family}.${key}`
        if (family === 'surfaces') {
          if (!SURFACE_KEY_RE.test(key)) push(errors, path, 'L5.surface.key', `非法 surface key: ${key}`)
          const surface = vocab.surfaces[key]
          if (surface === undefined) { push(errors, path, 'L2.unknown-key', `未知 surface: ${key}`); continue }
          if (!SURFACE_EMIT_RE.test(surface.emits)) push(errors, path, 'L5.surface.emits', `非法 emits: ${surface.emits}`)
          checkValueDomain(path, family, 'background-shorthand', value, errors)
          continue
        }
        if (family === 'chrome') {
          if (!CHROME_KEYS.has(key)) { push(errors, path, 'L2.unknown-key', `未知 chrome 键: ${key}`); continue }
          checkValueDomain(path, family, 'color', value, errors)
          continue
        }
        if (family === 'effects') {
          if (!EFFECT_KEYS.has(key)) { push(errors, path, 'L2.unknown-key', `未知 effects 键: ${key}`); continue }
          checkValueDomain(path, family, 'filter', value, errors)
          continue
        }
        if (family === 'assets') {
          if (!(vocab.assets ?? []).includes(key)) { push(errors, path, 'L2.unknown-key', `未知 asset 键: ${key}`); continue }
          checkValueDomain(path, family, 'url', value, errors)
          continue
        }
        if ((vocab.derivedKeys ?? []).includes(key)) { push(errors, path, 'L2.derived', `derived 键不可覆写: ${key}`); continue }
        const token = vocab.tokens[key]
        if (token === undefined) { push(errors, path, 'L2.unknown-key', `未知 token: ${key}`); continue }
        if (token.invariant) { push(errors, path, 'L2.invariant', `invariant 键不可覆写: ${key}`); continue }
        if (token.derived) { push(errors, path, 'L2.derived', `derived 键不可覆写: ${key}`); continue }
        checkValueDomain(path, family, token.domain, value, errors)
      }
    }
  }

  // L4 components 三段判
  if (skin.components !== undefined) {
    if (!isObject(skin.components)) {
      push(errors, '$.components', 'L4.components.type', 'components 必须是对象')
    } else {
      const registry = vocab.components ?? {}
      for (const [name, manifest] of Object.entries(skin.components)) {
        const path = `$.components.${name}`
        if (Object.keys(registry).length === 0) {
          push(errors, path, 'L4.components.empty-registry', `MS01 components registry 为空，拒绝组件名: ${name}`)
          continue
        }
        if (registry[name] === undefined) { push(errors, path, 'L4.components.unknown', `未注册组件: ${name}`); continue }
        if (!isObject(manifest)) { push(errors, path, 'L4.components.manifest', 'manifest 必须是对象'); continue }
        for (const sub of ['layout', 'vars', 'options', 'assets']) {
          if (manifest[sub] !== undefined && !isObject(manifest[sub])) push(errors, `${path}.${sub}`, 'L4.components.subdomain', `${sub} 必须是对象`)
        }
      }
    }
  }

  // L5 引用完整性（vocab 自身）
  const seenEmits = new Set<string>()
  for (const [key, surface] of Object.entries(vocab.surfaces)) {
    if (!SURFACE_EMIT_RE.test(surface.emits)) push(errors, `$.vocab.surfaces.${key}`, 'L5.surface.emits', `词表 emits 非法: ${surface.emits}`)
    if (seenEmits.has(surface.emits)) push(errors, `$.vocab.surfaces.${key}`, 'L5.surface.emits.duplicate', `emits 重复: ${surface.emits}`)
    seenEmits.add(surface.emits)
  }

  // L6 capability（E4：MS01 构建不支持的能力一律拒绝；dsh-default 空三族豁免）
  if (skin.slug !== 'dsh-default') {
    if (skin.fonts !== undefined && (!Array.isArray(skin.fonts) || skin.fonts.length > 0)) {
      push(errors, '$.fonts', 'L6.capability.unsupported', 'fonts 消费面在 MS01 构建不可用（unsupported-in-this-build）')
    }
    if (skin.sounds !== undefined && (!isObject(skin.sounds) || Object.keys(skin.sounds).length > 0)) {
      push(errors, '$.sounds', 'L6.capability.unsupported', 'sounds 消费面在 MS01 构建不可用（unsupported-in-this-build）')
    }
    if (skin.meta !== undefined && isObject(skin.meta) && skin.meta.lockMode !== undefined) {
      push(errors, '$.meta.lockMode', 'L6.capability.unsupported', 'meta.lockMode 在 v1 不实现（unsupported-in-this-build）')
    }
  }

  return { ok: errors.length === 0, errors }
}
