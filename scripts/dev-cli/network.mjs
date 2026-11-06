// dev-cli · 网络请求快照：get_simulator_network。
// 用法:
//   node scripts/dev-cli/network.mjs                    全量请求
//   node scripts/dev-cli/network.mjs --grep workbuddy   过滤
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const grep = flagOf(flags, 'grep', null)

const d = await ProbeDriver.open()
try {
  // schema: { command } = grep 命令串（作用于 IDE 侧 network 日志文件）
  const command = grep ? `grep -n -i ${JSON.stringify(grep)}` : 'grep -n .'
  const r = await d.text('get_simulator_network', { command })
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2))
} finally {
  d.close()
}
