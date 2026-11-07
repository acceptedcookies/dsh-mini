// dev-cli · 场景驱动：主题 + 分辨率/sysinfo 场景（T-O-4 边界: rpx 布局不可改）。
// 用法:
//   node scripts/dev-cli/scene.mjs dark|light|system          主题场景（设置页 onThemeMode 用户路径）
//   node scripts/dev-cli/scene.mjs --sysinfo '{"windowWidth":320,"windowHeight":480}'   JS 层分辨率 mock
//   node scripts/dev-cli/scene.mjs --page settings            深链场景（open_page）
//   node scripts/dev-cli/scene.mjs --page pages/workspace/workspace --scene 1001 --query 'k=v'
//   node scripts/dev-cli/scene.mjs --read                     当前 sysinfo/theme 读回
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags, positional } = parseArgs()
const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
try {
  const mode = positional[0]
  if (mode === 'dark' || mode === 'light' || mode === 'system') {
    // 设置页用户路径同构：nav → callMethod onThemeMode（settings.ts:176 → setTheme/useSystemTheme）
    const back = await d.route()
    await d.nav('reLaunch', '/pages/settings/settings')
    const r = await d.callMethod('onThemeMode', [{ currentTarget: { dataset: { mode } } }])
    const themeReadback = await d.eval('() => ({ theme: wx.getStorageSync("dsh:theme:v2") ?? "", nav: getCurrentPages().pop().route })')
    await d.nav('reLaunch', back === 'pages/settings/settings' ? '/pages/workspace/workspace' : `/${back}`)
    console.log(JSON.stringify({ scene: mode, callMethod: r?.result ?? r, readback: themeReadback?.result ?? themeReadback }, null, 2))
  } else if (flags.sysinfo !== undefined) {
    const patch = JSON.parse(flags.sysinfo)
    const mocked = []
    for (const m of ['getSystemInfoSync', 'getWindowInfo', 'getDeviceInfo']) {
      try { await d.mockWx(m, { result: patch }); mocked.push(m) } catch { /* 单项不支持不阻断 */ }
    }
    const readback = await d.eval('() => ({ w: wx.getWindowInfo().windowWidth, h: wx.getWindowInfo().windowHeight })')
    console.log(JSON.stringify({ mocked, patch, readback: readback?.result ?? readback, note: 'JS 层取值已 mock；rpx 布局随模拟器机型固定不可改（T-O-B4）' }, null, 2))
  } else if (flags.page !== undefined) {
    const params = { page: flagOf(flags, 'page', '') }
    if (flags.scene !== undefined) params.scene = Number(flags.scene)
    if (flags.query !== undefined) params.query = flags.query
    const r = await d.call('simulator_open_page', params)
    console.log(JSON.stringify({ page: params.page, scene: params.scene, query: params.query, result: r?.result ?? r }, null, 2))
  } else if (flags.read === true) {
    const r = await d.eval(`() => ({ theme: wx.getStorageSync('dsh:theme:v2') ?? '', win: { w: wx.getWindowInfo().windowWidth, h: wx.getWindowInfo().windowHeight, pr: wx.getWindowInfo().pixelRatio } })`)
    console.log(JSON.stringify(r?.result ?? r, null, 2))
  } else {
    console.error('用法: scene.mjs dark|light|system | --sysinfo \'{..}\' | --page p [--scene n --query q] | --read')
    process.exit(2)
  }
} finally {
  await d.close()
}
