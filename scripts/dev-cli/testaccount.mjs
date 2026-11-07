// dev-cli · 测试号 / 登录 ticket（DevTools 2.02.2609250 的 automation_testaccount）。
// 用法:
//   node scripts/dev-cli/testaccount.mjs list
//   node scripts/dev-cli/testaccount.mjs getTicket
//   node scripts/dev-cli/testaccount.mjs setTicket --ticket <t>
//   node scripts/dev-cli/testaccount.mjs refreshTicket
//   [--via skill|mcp] [--json]
// 语义: list/getTicket 只读；setTicket/refreshTicket 改 DevTools 登录态，属写操作。
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags, positional } = parseArgs()
const action = positional[0]
const OK = new Set(['list', 'getTicket', 'setTicket', 'refreshTicket'])
if (!OK.has(action)) {
  console.error(`用法: testaccount.mjs ${[...OK].join('|')} [--ticket t] [--via skill|mcp] [--json]`)
  process.exit(2)
}
const ticket = flagOf(flags, 'ticket', undefined)
if (action === 'setTicket' && (ticket === undefined || ticket === true)) {
  console.error('setTicket 需要 --ticket <t>')
  process.exit(2)
}
const json = boolFlag(flags, 'json')
const via = flagOf(flags, 'via', 'skill')

await runMain('testaccount', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    const r = await d.testaccount(action, ticket !== undefined ? { ticket } : {})
    return { action, result: r?.result ?? r }
  } finally {
    await d.close()
  }
}, { json })
