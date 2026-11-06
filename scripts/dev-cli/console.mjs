// dev-cli · console 读取：双通道。
//   --via mcp   → get_simulator_console 快照（模拟器历史 console，离线拉取）
//   --via auto  → automator 'console'/'exception' 事件实时监听（唯一覆盖真机调试的取道）
//
// 用法:
//   node scripts/dev-cli/console.mjs                     mcp 快照
//   node scripts/dev-cli/console.mjs --via mcp --grep err
//   node scripts/dev-cli/console.mjs --via auto --duration 30            监听 30s
//   node scripts/dev-cli/console.mjs --via auto -e '() => 1+1'           先执行再监听
//   AUTO_PORT=xx node scripts/dev-cli/console.mjs --via auto             复用真机调试会话
import { connectIde, pipeConsole } from './lib/ide.mjs'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const via = flagOf(flags, 'via', 'mcp')
const grep = flagOf(flags, 'grep', null)

if (via === 'mcp') {
  const d = await ProbeDriver.open()
  try {
    // schema: { command } = grep 命令串（作用于 IDE 侧 console 日志文件）
    const command = grep ? `grep -n -i ${JSON.stringify(grep)}` : 'grep -n .'
    const r = await d.text('get_simulator_console', { command })
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2))
  } finally {
    d.close()
  }
} else if (via === 'auto') {
  const duration = Number(flagOf(flags, 'duration', '30')) * 1000
  const evalSrc = flagOf(flags, 'e', null)
  const { mp, via: how, port } = await connectIde({})
  console.log(`[dev-cli] automator 已连接 (${how}:${port})，监听 ${duration / 1000}s…`)
  pipeConsole(mp)
  if (evalSrc) {
    const page = await mp.currentPage()
    const r = await page.callMethod ? await mp.evaluate(evalSrc) : await mp.evaluate(evalSrc)
    console.log('[eval]', JSON.stringify(r))
  }
  await new Promise((r) => setTimeout(r, duration))
  await mp.disconnect().catch(() => {})
} else {
  console.error('--via mcp | auto')
  process.exit(2)
}
