#!/usr/bin/env node
/**
 * skin-visual.mjs — MS01 视觉抽样链（P0 基线 / P6 收口证据）
 *
 * 通道：ProbeDriver → MCP（simulator_screenshot）。automator 9420 不可用已登记，
 * 本脚本不依赖 automator。场景切换一律走 `scene.mjs` 同构的用户路径：
 *   settings 页 `onThemeMode`（写 storage dsh:theme:v2 → 引擎/chrome 生效）。
 *
 * 用法：
 *   node scripts/dev-cli/skin-visual.mjs [--out <abs-dir>] [--prefix p0-]
 * 输出：<out>/<prefix><场景>.png（截图命令仅接绝对路径——PITFALL-6 EROFS）
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const OUT = resolve(flagOf(flags, 'out', '.anote/ms01-baseline/shots'))
const PRE = flagOf(flags, 'prefix', 'p0-')
mkdirSync(OUT, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
const results = []

async function shot(name) {
  const path = resolve(OUT, `${PRE}${name}.png`)
  const r = await d.text('simulator_screenshot', { path })
  results.push({ name, path, ok: r !== undefined })
  console.log(`  📸 ${name} → ${path}`)
}

async function go(route) {
  await d.nav('reLaunch', route)
  await wait(1200)
}

async function theme(mode) {
  await go('/pages/settings/settings')
  const r = await d.callMethod('onThemeMode', [{ currentTarget: { dataset: { mode } } }])
  await wait(500)
  return r?.result ?? r
}

async function pageSetData(data) {
  await d.eval(`() => { const p = getCurrentPages().pop(); p.setData(${JSON.stringify(data)}); return true }`)
  await wait(500)
}

try {
  // 1. settings light（用户路径切浅色）
  await theme('light')
  await shot('01-settings-light')

  // 2. workspace light
  await go('/pages/workspace/workspace')
  await shot('02-workspace-light')

  // 3. workspace tabs（非 hero，dsh-tabs underline）
  await pageSetData({ showHero: false })
  await shot('03-workspace-tabs-light')

  // 4. settings dark
  await theme('dark')
  await shot('04-settings-dark')

  // 5. workspace dark
  await go('/pages/workspace/workspace')
  await shot('05-workspace-dark')

  // 6. trajectory dark
  await pageSetData({ view: 'trajectory' })
  await shot('06-trajectory-dark')

  // 7. model picker 浮面（dark）
  await pageSetData({ view: 'trajectory' })
  await d.callMethod('openModelPicker', [])
  await pageSetData({ view: 'trajectory' })
  await wait(700)
  await shot('07-model-picker-dark')

  // 8. up-drawer 引擎抽屉（dark）
  await d.callMethod('closeModelPicker', [])
  await pageSetData({ view: 'trajectory' })
  await d.callMethod('openWorkspaceMenu', [])
  await wait(700)
  await shot('08-up-drawer-dark')
  await d.callMethod('closeEngineDrawer', [])

  // 9. dsh-menu 浮面（dark）
  await d.eval(`() => { const p = getCurrentPages().pop(); p.setData({ view: 'trajectory', menuVisible: true, menuTitle: '会话操作', menuItems: [{ id: 'rename', label: '重命名', icon: 'pencil-outline' }, { id: 'delete', label: '删除', icon: 'trash-outline' }], menuStyle: 'left: 12px; top: 96px; width: 176px;', menuContext: 'session', menuTargetId: 'demo' }); return true }`)
  await wait(500)
  await shot('09-menu-dark')
  await d.callMethod('closeMenu', [])

  // 10. models light
  await theme('light')
  await go('/pages/models/models')
  await shot('10-models-light')

  // 11. models dark
  await theme('dark')
  await go('/pages/models/models')
  await shot('11-models-dark')

  // 12. 回浅色收尾（环境整洁）
  await theme('light')
  await go('/pages/workspace/workspace')
  await shot('12-workspace-light-restore')

  console.log(JSON.stringify({ ok: true, out: OUT, count: results.length, results }, null, 2))
} finally {
  try { await theme('system') } catch { /* 收尾失败不掩盖主结果 */ }
  await d.close()
}
