// dev-cli · 元素几何：selector → boundingClientRect（含 selectAll）。
// 用法:
//   node scripts/dev-cli/geo.mjs -s '.chat-column'          单元素
//   node scripts/dev-cli/geo.mjs -s '.a,.b,.c'              多 selector 各取首个
//   node scripts/dev-cli/geo.mjs -s '.foot-row' --all       selectAll 全量矩形
import { McpClient } from './lib/mcp.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const sels = flagOf(flags, 's', '')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
const all = flags.all === true
if (sels.length === 0) {
  console.error('用法: node scripts/dev-cli/geo.mjs -s \'.sel[,.sel2]\' [--all]')
  process.exit(2)
}

const fnSource = `() => new Promise((resolve) => {
  const p = getCurrentPages().pop()
  const sels = ${JSON.stringify(sels)}
  const all = ${all}
  const rd = (r) => r === null ? null : ({ l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) })
  const out = { route: p.route }
  let pending = sels.length
  for (const sel of sels) {
    const q = p.createSelectorQuery()
    const method = all ? 'selectAll' : 'select'
    q[method](sel).boundingClientRect((r) => { out[sel] = all ? (r ?? []).map(rd) : rd(r); if (--pending === 0) resolve(out) }).exec()
  }
})`

const c = await McpClient.open({ quiet: true })
try {
  console.log(JSON.stringify(await c.eval(fnSource), null, 2))
} finally {
  c.close()
}
