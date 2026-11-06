// dev-cli · 截图：automation_viewport_action → 文件。
// 用法:
//   node scripts/dev-cli/shot.mjs                    → .anote/shots/dev-<ts>.png
//   node scripts/dev-cli/shot.mjs -o /tmp/x.png      → 指定路径
//   node scripts/dev-cli/shot.mjs --sim              → simulator_screenshot（优化长边 1280）
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { McpClient } from './lib/mcp.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const sim = flags.sim === true
// 截图落盘发生在 IDE 侧——必须绝对路径（相对路径会解析到 IDE 工作目录/根）
const out = resolve(flagOf(flags, 'o', `.anote/shots/dev-${Date.now()}.png`))
mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true })

const wait = flagOf(flags, 'wait', null)
const waitFor = flagOf(flags, 'for', null)
const extra = { ...(wait ? { wait: Number(wait) } : {}), ...(waitFor ? { waitForSelector: waitFor } : {}) }

const c = await McpClient.open({ quiet: true })
try {
  const r = sim
    ? await c.text('simulator_screenshot', { path: out, ...extra })
    : await c.text('automation_viewport_action', { action: 'screenshot', path: out, ...extra })
  console.log(JSON.stringify(r))
} finally {
  c.close()
}
