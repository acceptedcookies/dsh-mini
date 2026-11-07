// dev-cli · 网络请求快照：get_simulator_network（mcp / skill 双通道）。
// 用法:
//   node scripts/dev-cli/network.mjs                    全量请求
//   node scripts/dev-cli/network.mjs --grep workbuddy   过滤
//   node scripts/dev-cli/network.mjs --via skill        一次性 skill-call
//   node scripts/dev-cli/network.mjs --json             机器可读信封
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags } = parseArgs()
const grep = flagOf(flags, 'grep', null)
const via = flagOf(flags, 'via', undefined)
const json = boolFlag(flags, 'json')

await runMain('network', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    return await d.networkSnapshot(grep)
  } finally {
    await d.close()
  }
}, { json })
