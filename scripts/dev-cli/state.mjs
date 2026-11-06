// dev-cli · 页面状态投影：route + data 键值（-k 过滤键，逗号分隔；默认全量浅投影）。
// 用法:
//   node scripts/dev-cli/state.mjs                → route + 全部 data 顶层键值（截断）
//   node scripts/dev-cli/state.mjs -k view,theme  → 只取指定键
//   node scripts/dev-cli/state.mjs --deep input   → 取 data.input 完整值
import { McpClient } from './lib/mcp.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const keys = flagOf(flags, 'k', '')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
const deep = flagOf(flags, 'deep', null)

const fnSource = `() => {
  const p = getCurrentPages().pop()
  const keys = ${JSON.stringify(keys)}
  const deep = ${JSON.stringify(deep)}
  if (deep) return { route: p.route, value: p.data?.[deep] }
  const data = p.data ?? {}
  const pick = keys.length ? keys : Object.keys(data)
  const out = { route: p.route }
  for (const k of pick) {
    const v = data[k]
    try { out[k] = JSON.parse(JSON.stringify(v)) } catch { out[k] = String(v) }
  }
  return out
}`

const c = await McpClient.open({ quiet: true })
try {
  console.log(JSON.stringify(await c.eval(fnSource), null, 2))
} finally {
  c.close()
}
