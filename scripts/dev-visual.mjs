// dev-visual.mjs — UT-5x 视觉回归：automator 连接运行中的 DevTools（不启动/不杀），双主题截图
// 前提：DevTools 已打开本项目 + 服务端口开启（ws 9420）。输出 .anote/shots/ut-*.png
// 用法: node scripts/dev-visual.mjs [--port 9420]
import automator from 'miniprogram-automator'
import { mkdirSync } from 'node:fs'

const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '9420'
const OUT = '.anote/shots'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (mp, name) => { await mp.screenshot({ path: `${OUT}/${name}.png` }); console.log(`  📸 ${name}`) }

// 服务端口未开时 connect 失败 → launch 经 CLI 在同一 DevTools 实例新开自动化窗口（不杀既有会话）
let mp
try {
  mp = await automator.connect({ wsEndpoint: `ws://localhost:${PORT}` })
  console.log('connected (existing window).')
} catch {
  console.log('service port closed → automator.launch（新开自动化窗口，不动既有会话）…')
  mp = await automator.launch({ projectPath: process.cwd(), port: Number(PORT) })
  console.log('launched.')
}

// 1. workspace 当前态（浅色基线）
await mp.reLaunch('/pages/workspace/workspace')
await wait(1500)
let page = await mp.currentPage()
console.log('page:', page.path)
await shot(mp, 'ut-01-workspace-light')

// 2. 强制非 hero 态 → dsh-tabs 页级 underline 可见
await page.setData({ showHero: false })
await wait(600)
await shot(mp, 'ut-02-workspace-tabs-light')

// 3. settings → 切深色（真实用户路径 onThemeMode → setTheme → setBackgroundColor）
await mp.reLaunch('/pages/settings/settings')
await wait(1200)
page = await mp.currentPage()
const segs = await page.$$('.segment')
console.log('segments:', segs.length)
if (segs.length >= 3) {
  await segs[2].tap() // 深色
  await wait(800)
}
await shot(mp, 'ut-03-settings-dark')

// 4. 回 workspace 看暗色 tab + 全局底
await mp.reLaunch('/pages/workspace/workspace')
await wait(1200)
page = await mp.currentPage()
await page.setData({ showHero: false })
await wait(600)
await shot(mp, 'ut-04-workspace-dark')

// 5. 切轨迹视图看 dsh-tabs 状态（无数据也验证渲染）
await page.setData({ view: 'trajectory' })
await wait(600)
await shot(mp, 'ut-05-trajectory-dark')

// 6. 回浅色收尾（保持业主环境整洁）
await mp.reLaunch('/pages/settings/settings')
await wait(1000)
page = await mp.currentPage()
const segs2 = await page.$$('.segment')
if (segs2.length >= 2) { await segs2[1].tap(); await wait(500) }
await shot(mp, 'ut-06-settings-light-restore')

console.log('done. shots →', OUT)
await mp.disconnect()
process.exit(0)
