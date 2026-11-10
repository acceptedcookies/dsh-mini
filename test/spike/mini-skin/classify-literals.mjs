/**
 * MS02 §5.5 判词规程的机械分类。
 * 一条声明进入 vars，当且仅当它是单个 length 或单个 color，
 * 单位落在 px/%/vh/vw，且不在排除清单里。
 * 三特例与 up-drawer 三键由调用方覆盖，不在这里改口。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export const FROZEN_VERDICT = {
  'up-drawer': 'full',
  'trajectory-view': 'empty-invariant',
  'markdown-view': 'empty-service',
  'dsh-icon': 'empty-asset',
}

const LENGTH_RE = /^(-?(?:\d+|\d*\.\d+))(px|%|vh|vw)$/
const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent|currentColor)$/

export function stripComments(text) {
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

function hasTopSemicolon(value) {
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ';' && depth === 0) return true
  }
  return false
}

export function scanLessDecls(absFile, root) {
  const text = stripComments(readFileSync(absFile, 'utf8'))
  const lines = text.split('\n')
  const stack = []
  const decls = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
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
      const headers = stack.slice()
      decls.push({
        file: relative(root, absFile),
        line: start + 1,
        selector: headers[headers.length - 1] ?? '',
        prop,
        value,
        inMedia: headers.some((h) => h.startsWith('@media')),
        inKeyframes: headers.some((h) => h.includes('keyframes')),
      })
      i += 1
      continue
    }
    i += 1
  }
  return decls
}

export function exclusionOf(decl) {
  const { prop, value } = decl
  if (decl.inMedia) return '@media'
  if (decl.inKeyframes) return '@keyframes'
  if (prop.startsWith('--')) return null
  if (value.includes('var(--dsw-')) return 'var(--dsw-'
  if (value.includes('var(--app-')) return 'var(--app-'
  if (value.includes('blur(')) return 'blur('
  if (/\bmin\(/.test(value) || /\bcalc\(/.test(value) || /\bclamp\(/.test(value)) return 'calc('
  if (prop === 'z-index') return 'z-index'
  if (prop === 'opacity') return 'opacity'
  if (prop === 'flex' || prop.startsWith('flex-')) return 'flex'
  if (prop === 'inset' || prop.startsWith('inset-')) return 'inset'
  if (prop === 'min-width' && value === '0') return 'min-width: 0'
  if ((prop === 'width' || prop === 'height') && value === '100%') return '100%'
  if (/^(?:animation|transition)/.test(prop)) return 'animation'
  return null
}

export function domainOf(decl) {
  const excluded = exclusionOf(decl)
  if (excluded !== null) return null
  if (LENGTH_RE.test(decl.value)) {
    const unit = LENGTH_RE.exec(decl.value)[2]
    return { kind: 'length', units: [unit] }
  }
  if (COLOR_RE.test(decl.value)) return { kind: 'color' }
  return null
}

function tokenName(component, prop, index) {
  const slug = prop.replace(/[^a-z0-9-]/g, '')
  return index === 0 ? `--dsw-${component}-${slug}` : `--dsw-${component}-${slug}-${index + 1}`
}

export function selectVars(component, decls) {
  if (FROZEN_VERDICT[component] && FROZEN_VERDICT[component] !== 'full') return []
  if (component === 'up-drawer') {
    const wanted = [
      { line: 32, prop: 'height', token: '--dsw-upd-height' },
      { line: 49, prop: 'top', token: '--dsw-upd-close-top' },
      { line: 56, prop: 'width', token: '--dsw-upd-close-size' },
      { line: 57, prop: 'height', token: '--dsw-upd-close-size' },
    ]
    return wanted.map((w) => {
      const decl = decls.find((d) => d.line === w.line && d.prop === w.prop)
      if (decl === undefined) throw new Error(`up-drawer 缺 ${w.prop}@${w.line}`)
      const domain = domainOf(decl)
      if (domain === null || domain.kind !== 'length') throw new Error(`up-drawer ${w.prop}@${w.line} 不是 length: ${decl.value}`)
      return { ...decl, token: w.token, kind: 'length', units: domain.units }
    })
  }
  const counts = new Map()
  const out = []
  for (const decl of decls) {
    const domain = domainOf(decl)
    if (domain === null) continue
    const n = counts.get(decl.prop) ?? 0
    counts.set(decl.prop, n + 1)
    out.push({ ...decl, token: tokenName(component, decl.prop, n), kind: domain.kind, units: domain.units })
  }
  return out
}

export function listComponentDirs(root) {
  return readdirSync(join(root, 'components'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
}

export function scanComponent(root, name) {
  const abs = join(root, 'components', name, `${name}.less`)
  const decls = scanLessDecls(abs, root)
  const vars = selectVars(name, decls)
  const frozen = FROZEN_VERDICT[name]
  let verdict = frozen ?? (vars.length > 0 ? 'vars+options' : 'empty')
  if (frozen === 'full' && vars.length === 0) throw new Error('up-drawer 被判成没有 vars')
  return { name, decls, vars, verdict }
}
