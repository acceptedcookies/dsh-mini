// dev-cli · MCP 通用直调：任意 tool 透传（逃逸舱门——新工具先从这里试）。
// 用法: node scripts/dev-cli/mcp.mjs <tool> '<json-args>'   （project 自动注入）
//   例: node scripts/dev-cli/mcp.mjs automation_evaluate '{"action":"evaluate","fnSource":"() => 1+1"}'
//       node scripts/dev-cli/mcp.mjs get_simulator_network '{}'
import { McpClient } from './lib/mcp.mjs'

const [tool, argsJson] = process.argv.slice(2)
if (!tool) {
  console.error('用法: node scripts/dev-cli/mcp.mjs <tool> \'<json-args>\'')
  process.exit(2)
}
const args = argsJson ? JSON.parse(argsJson) : {}

const c = await McpClient.open()
try {
  const r = await c.call(tool, args)
  const text = r?.result?.content?.[0]?.text
  console.log(text ?? JSON.stringify(r?.result ?? r?.error ?? r, null, 2))
} finally {
  c.close()
}
