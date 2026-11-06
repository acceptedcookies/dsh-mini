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

export const REPO_ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
export const PROJECT = process.env.DSH_PROJECT ?? REPO_ROOT
