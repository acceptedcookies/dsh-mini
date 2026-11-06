// dev-cli · 元素动作：@anchor 或裸 selector → element_action 18 动作全通。
// 用法:
//   node scripts/dev-cli/act.mjs @workspace.sidebar.modelConfig tap
//   node scripts/dev-cli/act.mjs @composer.input input -v '测试文本'
//   node scripts/dev-cli/act.mjs @session.row tap --id <sessionId>
//   node scripts/dev-cli/act.mjs @chat.scroll scrollTo --x 0 --y 300
//   node scripts/dev-cli/act.mjs '.cls' tap                     裸 selector
//   --id v       wx:for 动态行实例鉴别（拼 [disc="v"]）
//   --wait s / --for sel   element_action 等待链透传
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags, positional } = parseArgs()
const [target, action] = positional
const OK = new Set(['tap','longpress','trigger','input','size','offset','text','attribute','value','property','wxml','outerWxml','style','scrollWidth','scrollHeight','scrollTo','touchstart','touchmove','touchend'])
if (!target || !OK.has(action)) {
  console.error(`用法: node act.mjs <@anchor|selector> <action> [--id v] [--v value|--value v] [--x --y] [--type t] [--name n] [--wait s] [--for sel]\naction ∈ ${[...OK].join(' | ')}`)
  process.exit(2)
}

const params = {}
for (const k of ['value', 'type', 'detail', 'name', 'touches', 'changedTouches']) {
  const v = flagOf(flags, k, undefined)
  if (v !== undefined) params[k] = /^[{[]/.test(String(v)) ? JSON.parse(v) : v
}
const v0 = flagOf(flags, 'v', undefined)
if (v0 !== undefined && params.value === undefined) params.value = v0
for (const k of ['x', 'y']) {
  const v = flagOf(flags, k, undefined)
  if (v !== undefined) params[k] = Number(v)
}

const d = await ProbeDriver.open()
try {
  const r = await d.act(target, action, params, {
    id: flagOf(flags, 'id', undefined),
    wait: flags.wait !== undefined ? Number(flags.wait) : undefined,
    waitForSelector: flagOf(flags, 'for', undefined),
  })
  console.log(JSON.stringify(r?.result ?? r, null, 2))
} finally {
  await d.close()
}
