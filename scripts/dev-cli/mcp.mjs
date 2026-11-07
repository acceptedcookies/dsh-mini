// dev-cli · 任意工具透传（逃逸舱门——新工具先从这里试）。
// 用法:
//   node scripts/dev-cli/mcp.mjs <tool> '<json-args>'          （默认 MCP 桥）
//   node scripts/dev-cli/mcp.mjs <tool> '<json-args>' --via skill
//   node scripts/dev-cli/mcp.mjs <tool> '<json-args>' --json   （完整 report 信封）
//   [--timeout ms]
//   例: node scripts/dev-cli/mcp.mjs automation_evaluate '{"action":"evaluate","fnSource":"() => 1+1"}'
//       node scripts/dev-cli/mcp.mjs get_simulator_network '{}'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag, numberFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags, positional } = parseArgs()
const [tool, argsJson] = positional
if (!tool) {
  console.error('用法: node scripts/dev-cli/mcp.mjs <tool> \'<json-args>\' [--via mcp|skill] [--timeout ms] [--json]')
  process.exit(2)
}
const args = argsJson ? JSON.parse(argsJson) : {}
const json = boolFlag(flags, 'json')
const via = flagOf(flags, 'via', undefined)
const timeoutMs = numberFlag(flags, 'timeout', 30000)

await runMain('mcp', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    const r = await d.call(tool, args, { timeoutMs })
    const text = r?.result?.content?.[0]?.text
    if (typeof text === 'string') {
      try { return JSON.parse(text) } catch { return text }
    }
    return r?.result?.structuredContent ?? r?.result ?? r
  } finally {
    await d.close()
  }
}, { json })
