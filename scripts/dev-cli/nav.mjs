// dev-cli · 页面导航：automation_navigate 封装。
// 用法:
//   node scripts/dev-cli/nav.mjs navigateTo /pages/models/models
//   node scripts/dev-cli/nav.mjs reLaunch /pages/workspace/workspace
//   node scripts/dev-cli/nav.mjs navigateBack [--delta 2]
// 已知：navigate 偶发 'timeout' 但实际已跳转——脚本会随后读当前 route 如实回报。
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags, positional } = parseArgs()
const [action = 'reLaunch', url] = positional
const delta = Number(flagOf(flags, 'delta', '1'))
const ok = new Set(['navigateTo', 'reLaunch', 'redirectTo', 'navigateBack'])
if (!ok.has(action)) {
  console.error(`action ∈ ${[...ok].join(' | ')}`)
  process.exit(2)
}

const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
try {
  const r = await d.nav(action, action === 'navigateBack' ? undefined : url, action === 'navigateBack' ? { delta } : {})
  console.log(JSON.stringify(r))
} finally {
  d.close()
}
