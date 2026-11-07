// dev-cli · console 读取：三通道。
//   --via mcp   → get_simulator_console 快照（模拟器历史 console，离线拉取）
//   --via skill → 同工具，一次性 skill-call（不建 MCP 桥）
//   --via auto  → automator 'console'/'exception' 事件实时监听（唯一覆盖真机调试的取道）
//
// 用法:
//   node scripts/dev-cli/console.mjs                     mcp 快照
//   node scripts/dev-cli/console.mjs --via skill --grep err
//   node scripts/dev-cli/console.mjs --via auto --duration 30
//   node scripts/dev-cli/console.mjs --via auto -e '() => 1+1'
//   AUTO_PORT=xx node scripts/dev-cli/console.mjs --via auto
import { connectIde, pipeConsole } from './lib/ide.mjs'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags } = parseArgs()
const via = flagOf(flags, 'via', 'mcp')
const grep = flagOf(flags, 'grep', null)
const json = boolFlag(flags, 'json')

if (via === 'auto') {
  const duration = Number(flagOf(flags, 'duration', '30')) * 1000
  const evalSrc = flagOf(flags, 'e', null)
  const { mp, via: how, port } = await connectIde({})
  console.log(`[dev-cli] automator 已连接 (${how}:${port})，监听 ${duration / 1000}s…`)
  pipeConsole(mp)
  if (evalSrc) {
    const r = await mp.evaluate(evalSrc)
    console.log('[eval]', JSON.stringify(r))
  }
  await new Promise((r) => setTimeout(r, duration))
  await mp.disconnect().catch(() => {})
} else if (via === 'mcp' || via === 'skill') {
  await runMain('console', async () => {
    const d = await ProbeDriver.open({ via })
    try {
      return await d.consoleSnapshot(grep)
    } finally {
      await d.close()
    }
  }, { json })
} else {
  console.error('--via mcp | skill | auto')
  process.exit(2)
}
