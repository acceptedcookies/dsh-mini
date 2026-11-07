/** dev-cli 通用 flag 解析：--key value / --key=value / --flag / 位置参数。 */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const isLong = a.startsWith('--')
    const isShort = /^-[a-zA-Z]$/.test(a)
    if (isLong || isShort) {
      const key = a.slice(isLong ? 2 : 1)
      const eq = key.indexOf('=')
      if (eq !== -1) {
        flags[key.slice(0, eq)] = key.slice(eq + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[key] = argv[++i]
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { flags, positional }
}

export function flagOf(flags, key, dflt) {
  const v = flags[key]
  return v === undefined || v === true ? dflt : v
}

export function boolFlag(flags, key, dflt = false) {
  const v = flags[key]
  if (v === undefined) return dflt
  if (v === true) return true
  return /^(1|true|yes|on)$/i.test(String(v))
}

export function numberFlag(flags, key, dflt) {
  const v = flagOf(flags, key, undefined)
  if (v === undefined) return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

export function jsonFlag(flags, key, dflt) {
  const v = flagOf(flags, key, undefined)
  if (v === undefined) return dflt
  try { return JSON.parse(String(v)) } catch { throw new Error(`--${key} 不是合法 JSON: ${String(v).slice(0, 120)}`) }
}

export function wantJson(argv = process.argv.slice(2)) {
  return argv.includes('--json')
}

export const REPO_ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
export const PROJECT = process.env.DSH_PROJECT ?? REPO_ROOT
export const ANOTE_DIR = `${REPO_ROOT}/.anote/dev-cli`
