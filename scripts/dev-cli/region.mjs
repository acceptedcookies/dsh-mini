// dev-cli · 区域截图：@anchor/selector → geo → 全图 → jimp 裁切 → region.png + 元数据 json。
// 用法:
//   node scripts/dev-cli/region.mjs @composer.send
//   node scripts/dev-cli/region.mjs @workspace.foot-right -o .anote/shots/x.png
//   node scripts/dev-cli/region.mjs '.foot-row' --sel       （裸 selector）
import { ProbeDriver } from './lib/probe.mjs'
import regionRun from './lib/region-run.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags, positional } = parseArgs()
let [target] = positional
if (!target) {
  console.error('用法: node region.mjs <@anchor|selector> [-o out.png] [--id v] [--sel]')
  process.exit(2)
}
if (flags.sel === true && !target.startsWith('@') && !target.startsWith('[')) target = target

const d = await ProbeDriver.open()
try {
  const r = await regionRun(d, target, flags)
  console.log(JSON.stringify(r, null, 2))
} finally {
  await d.close()
}
