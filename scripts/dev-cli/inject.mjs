// dev-cli · 注入：四键互斥三分流 + mock 配对 restore（T-O-3）。
//   --data '{k:v}'                → page_action setData patch（page.data 道）
//   --call m [--args '[]']        → page_action callMethod
//   --hook H --fn '<fnSource>'    → evaluate 道（限域钩子白名单 app.ts:65-83）
//   --mock-wx m [--result j|--fn 'src'] → wx_api mock + 会话登记
//   --restore [m]                 → 恢复指定/全部 mock；默认 close 时自动 restore 全部
// 用法:
//   node inject.mjs --data '{"showHero":false}'
//   node inject.mjs --call onThemeMode --args '[{"currentTarget":{"dataset":{"mode":"dark"}}}]'
//   node inject.mjs --hook __errorBus --fn "() => getApp().globalData.__errorBus.report(new Error('x'),{op:'probe'})"
//   node inject.mjs --mock-wx getSystemInfoSync --result '{"windowWidth":320}'
//   node inject.mjs --restore getSystemInfoSync        （同桥验证请走 session.mjs）
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const modes = ['data', 'call', 'hook', 'mock-wx'].filter((k) => flags[k] !== undefined)
if (flags.restore !== undefined) modes.push('restore')
if (modes.length !== 1) {
  console.error('inject 四键互斥：--data | --call | --hook | --mock-wx（--restore 单独）')
  process.exit(2)
}

const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
try {
  let r
  if (flags.data !== undefined) {
    r = await d.setData(JSON.parse(flags.data))
  } else if (flags.call !== undefined) {
    r = await d.callMethod(flags.call, flags.args !== undefined ? JSON.parse(flags.args) : [])
  } else if (flags.hook !== undefined) {
    const fn = flagOf(flags, 'fn', flagOf(flags, 'e', null))
    if (!fn) { console.error('--hook 需 --fn \'<fnSource>\''); process.exit(2) }
    r = await d.hook(flags.hook, fn)
  } else if (flags['mock-wx'] !== undefined) {
    r = await d.mockWx(flags['mock-wx'], {
      result: flags.result !== undefined ? JSON.parse(flags.result) : undefined,
      functionDeclaration: flagOf(flags, 'fn', undefined),
    })
    console.log('[inject] mock 已登记——单发模式 close 时自动 restore；同桥回读验证请用 session.mjs')
  } else {
    // --restore
    const m = flagOf(flags, 'restore', null)
    r = m ? await d.restoreWx(m) : { restored: [...d.pendingMocks] }
    if (!m) for (const mm of [...d.pendingMocks]) await d.restoreWx(mm)
  }
  console.log(JSON.stringify(r?.result ?? r, null, 2))
} finally {
  await d.close()
}
