// dev-cli · 模拟器重编译：simulator_refresh（触发 wxss/ts 热载）。
// 用法: node scripts/dev-cli/refresh.mjs [--wait 6000]
// 已知：重编译期间 evaluate 会 'timeout waiting for automator response'——
// --wait 等待编译沉降，默认 6000ms。
import { sleep } from './lib/mcp.mjs'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const wait = Number(flagOf(flags, 'wait', '6000'))

const d = await ProbeDriver.open()
try {
  const r = await d.mcp.refresh()
  console.log('refresh:', JSON.stringify(r?.result?.content?.[0]?.text ?? r?.result ?? r))
  await sleep(wait)
  const route = await d.eval('() => getCurrentPages().pop().route').catch((e) => `? (${e.message})`)
  console.log('route:', route)
} finally {
  d.close()
}
