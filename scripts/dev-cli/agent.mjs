// dev-cli · IDE 内置 AI agent（cli agent）薄封装。
//
// ⚠ 非确定性通道：agent 由 LLM 驱动，不能作为 GSTH/验收判定通道；
//    仅用于探索性 UI 验证、Agent 卡片渲染/取图、人工辅助排障。
//    确定性测试请用 MCP / skill / automator 三通道。
//
// 用法:
//   node scripts/dev-cli/agent.mjs start                         常驻 agent server（继承 stdio）
//   node scripts/dev-cli/agent.mjs tool --name <n> --args '<json>'
//   node scripts/dev-cli/agent.mjs chat --query '...' [--session-id s] [--skill s]
//   node scripts/dev-cli/agent.mjs render --name <n> --args '<json>'
//   node scripts/dev-cli/agent.mjs card-click --card-id <id>
//   node scripts/dev-cli/agent.mjs get-dom | get-card-image | clear | debug | overlay | detail-close
//   [--json] [--quiet]
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags, positional } = parseArgs()
const sub = positional[0]
const OK = new Set(['start', 'tool', 'chat', 'render', 'card-click', 'get-dom', 'get-card-image', 'clear', 'debug', 'overlay', 'detail-close'])
if (!OK.has(sub)) {
  console.error(`用法: agent.mjs <${[...OK].join('|')}> [...] [--json]`)
  process.exit(2)
}
const json = boolFlag(flags, 'json')
const quiet = boolFlag(flags, 'quiet')
if (!quiet) console.error('[agent] 非确定性 AI 面——不要用于 GSTH/验收判定；确定性测试用 MCP/skill/automator')

await runMain('agent', async () => {
  const d = await ProbeDriver.open({ via: 'agent' })
  try {
    if (sub === 'start') {
      const r = await d.agent.start()
      return { sub, started: true, code: r.code }
    }
    if (sub === 'tool') {
      const name = flagOf(flags, 'name', null)
      if (name === null) throw new Error('tool 需要 --name')
      const args = flagOf(flags, 'args', '{}')
      return { sub, ...(await d.agent.tool(name, JSON.parse(args))) }
    }
    if (sub === 'chat') {
      const query = flagOf(flags, 'query', null)
      if (query === null) throw new Error('chat 需要 --query')
      return { sub, ...(await d.agent.chat(query, {
        sessionId: flagOf(flags, 'session-id', undefined),
        skill: flagOf(flags, 'skill', undefined),
        timeout: flagOf(flags, 'timeout', undefined),
      })) }
    }
    if (sub === 'render') {
      const name = flagOf(flags, 'name', null)
      if (name === null) throw new Error('render 需要 --name')
      const args = flagOf(flags, 'args', '{}')
      return { sub, ...(await d.agent.render(name, JSON.parse(args))) }
    }
    if (sub === 'card-click') {
      const cardId = flagOf(flags, 'card-id', null)
      if (cardId === null) throw new Error('card-click 需要 --card-id')
      return { sub, ...(await d.agent.cardClick(cardId)) }
    }
    return { sub, ...(await d.agentRun(sub)) }
  } finally {
    await d.close()
  }
}, { json })
