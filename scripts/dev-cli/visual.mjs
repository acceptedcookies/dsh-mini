// dev-cli · UT-5x 视觉回归：automator 连接运行中 DevTools，双主题截图套件。
// 输出 .anote/shots/ut-*.png。用法:
//   node scripts/dev-cli/visual.mjs                  AUTO_PORT/ws9420 → cli auto 回退
//   node scripts/dev-cli/visual.mjs --port 9602
//   node scripts/dev-cli/visual.mjs --out .anote/shots --prefix ut-
// 通道：AUTO_PORT env 优先 → 服务端口 ws 直连 → cli auto 拉起（同 connectIde 契约）。
import { mkdirSync } from 'node:fs'
import { connectIde } from './lib/ide.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const PORT = Number(flagOf(flags, 'port', process.env.AUTO_PORT ?? '9420'))
const OUT = flagOf(flags, 'out', '.anote/shots')
const PRE = flagOf(flags, 'prefix', 'ut-')
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (mp, name) => { await mp.screenshot({ path: `${OUT}/${name}.png` }); console.log(`  📸 ${name}`) }

const { mp, via, port } = await connectIde({ port: PORT })
console.log(`automator 已连接 (${via}:${port})`)

// 1. workspace 当前态（浅色基线）
await mp.reLaunch('/pages/workspace/workspace')
await wait(1500)
let page = await mp.currentPage()
console.log('page:', page.path)
await shot(mp, `${PRE}01-workspace-light`)

// 2. 强制非 hero 态 → dsh-tabs 页级 underline 可见
await page.setData({ showHero: false })
await wait(600)
await shot(mp, `${PRE}02-workspace-tabs-light`)

// 3. settings → 切深色（真实用户路径 onThemeMode → setTheme → setBackgroundColor）
await mp.reLaunch('/pages/settings/settings')
await wait(1200)
page = await mp.currentPage()
const segs = await page.$$('.segment')
console.log('segments:', segs.length)
if (segs.length >= 3) {
  await segs[2].tap()
  await wait(800)
}
await shot(mp, `${PRE}03-settings-dark`)

// 4. 回 workspace 看暗色 tab + 全局底
await mp.reLaunch('/pages/workspace/workspace')
await wait(1200)
page = await mp.currentPage()
await page.setData({ showHero: false })
await wait(600)
await shot(mp, `${PRE}04-workspace-dark`)

// 5. 切轨迹视图
await page.setData({ view: 'trajectory' })
await wait(600)
await shot(mp, `${PRE}05-trajectory-dark`)

// 6. 回浅色收尾（保持业主环境整洁）
await mp.reLaunch('/pages/settings/settings')
await wait(1000)
page = await mp.currentPage()
const segs2 = await page.$$('.segment')
if (segs2.length >= 2) { await segs2[1].tap(); await wait(500) }
await shot(mp, `${PRE}06-settings-light-restore`)

console.log('done. shots →', OUT)
await mp.disconnect()
process.exit(0)
