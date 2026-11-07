// dev-cli · skill-cli 透传（wechatide -c <client> <tool>）。
// 用法:
//   node scripts/dev-cli/skill.mjs <tool> '<json-args>'
//   node scripts/dev-cli/skill.mjs automation_runtime_info '{"action":"currentPage"}'
//   [--json] [--client name] [--timeout ms]
// 语义: 一次性进程，不建 MCP 桥；适合只读/一次性调用。批量动作请用 session.mjs。
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag, numberFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags, positional } = parseArgs()
const [tool, argsJson] = positional
if (!tool) {
  console.error('用法: skill.mjs <tool> \'<json-args>\' [--json] [--client name] [--timeout ms]')
  process.exit(2)
}
const args = argsJson ? JSON.parse(argsJson) : {}
const json = boolFlag(flags, 'json')
const timeoutMs = numberFlag(flags, 'timeout', 30000)

await runMain('skill', async () => {
  const d = await ProbeDriver.open({
    via: 'skill',
    fallback: false,
    skillOpts: {
      ...(flagOf(flags, 'client', undefined) !== undefined ? { client: flagOf(flags, 'client') } : {}),
    },
  })
  try {
    const r = await d.skillCall(tool, args, { timeoutMs })
    return r
  } finally {
    await d.close()
  }
}, { json })
