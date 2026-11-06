// dev-cli · 页面导航：automation_navigate 封装。
// 用法:
//   node scripts/dev-cli/nav.mjs navigateTo /pages/models/models
//   node scripts/dev-cli/nav.mjs reLaunch /pages/workspace/workspace
//   node scripts/dev-cli/nav.mjs navigateBack [--delta 2]
// 已知：navigate 偶发 'timeout' 但实际已跳转——脚本会随后读当前 route 如实回报。
import { McpClient, sleep } from './lib/mcp.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags, positional } = parseArgs()
const [action = 'reLaunch', url] = positional
const delta = Number(flagOf(flags, 'delta', '1'))
const ok = new Set(['navigateTo', 'reLaunch', 'redirectTo', 'navigateBack'])
if (!ok.has(action)) {
  console.error(`action ∈ ${[...ok].join(' | ')}`)
  process.exit(2)
}

const c = await McpClient.open({ quiet: true })
try {
  const args = action === 'navigateBack' ? { action, delta } : { action, url }
  const r = await c.navigate(action, args.url, action === 'navigateBack' ? { delta } : {}).catch((e) => ({ navTimeout: e.message }))
  if (r?.navTimeout) console.log('nav 响应超时（可能已跳转），回报当前 route…')
  await sleep(800)
  const route = await c.eval('() => getCurrentPages().pop().route').catch(() => '?')
  console.log(JSON.stringify({ nav: r?.navTimeout ?? r, route }))
} finally {
  c.close()
}
