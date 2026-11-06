// dev-cli · 枚举 MCP 工具面：tools/list 按前缀分组打印。
// 用法: node scripts/dev-cli/tools.mjs [--json]
import { McpClient } from './lib/mcp.mjs'

const json = process.argv.includes('--json')
const c = await McpClient.open()
try {
  const r = await c.rpc('tools/list', {}, 15000)
  const tools = r?.result?.tools ?? []
  if (json) {
    console.log(JSON.stringify(tools.map((t) => t.name), null, 2))
  } else {
    const groups = {}
    for (const t of tools) {
      const g = t.name.split('_')[0]
      ;(groups[g] ??= []).push(t.name)
    }
    for (const [g, names] of Object.entries(groups)) {
      console.log(`\n[${g}] (${names.length})`)
      for (const n of names) console.log(`  ${n}`)
    }
    console.log(`\ntotal: ${tools.length} tools`)
  }
} finally {
  c.close()
}
