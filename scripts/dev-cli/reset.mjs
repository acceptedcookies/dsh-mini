// dev-cli · 状态复位：debug_clear_cache 9 类透传。
// 用法:
//   node scripts/dev-cli/reset.mjs                  → cleanStorageCache（默认）
//   node scripts/dev-cli/reset.mjs --type all       → cleanAll
//   node scripts/dev-cli/reset.mjs --type session   → clearSession
// 类型: storage|file|session|auth|webview|compile|filelist|allsim|all
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const MAP = {
  storage: 'cleanStorageCache', file: 'cleanFileCache', session: 'clearSession',
  auth: 'clearAuth', webview: 'cleanWebViewCache', compile: 'cleanCompileCache',
  filelist: 'cleanProjectFileListCache', allsim: 'cleanAllSimulatorCache', all: 'cleanAll',
}
const { flags } = parseArgs()
const t = flagOf(flags, 'type', 'storage')
const action = MAP[t] ?? (Object.values(MAP).includes(t) ? t : null)
if (!action) {
  console.error(`--type ∈ ${Object.keys(MAP).join(' | ')}`)
  process.exit(2)
}

const d = await ProbeDriver.open()
try {
  const r = await d.clearCache(action)
  console.log(JSON.stringify({ action, result: r?.result ?? r }))
} finally {
  await d.close()
}
