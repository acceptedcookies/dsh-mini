// dev-cli · 模拟器重编译：simulator_refresh（触发 wxss/ts 热载）。
// 用法: node scripts/dev-cli/refresh.mjs [--wait 6000]
// 已知：重编译期间 evaluate 会 'timeout waiting for automator response'——
// --wait 等待编译沉降，默认 6000ms。
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const wait = Number(flagOf(flags, 'wait', '6000'))

const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
try {
  const r = await d.refresh(wait)
  console.log('refresh:', JSON.stringify(r.refresh))
  console.log('route:', r.route)
} finally {
  await d.close()
}
