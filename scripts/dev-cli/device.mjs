// dev-cli · 真机链路：remote 拉起 → 四件套 dump（T-O-5）。
// 用法:
//   node scripts/dev-cli/device.mjs --remote            真机调试拉起 + dump
//   node scripts/dev-cli/device.mjs --dump-only        不拉起，对当前 attach 通道直接 dump
//   node scripts/dev-cli/device.mjs --seconds 15       console 采集时长（默认 10s）
//
// 产物: .anote/device/<ts>/{diag.json, storage.json, console.log, shots/*.png}
// 出口: 0=pass  3=skip(物理设备缺席，机器可读 reason)  4=degraded(设备在场但 remote/dump 失败)
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { ProbeDriver } from './lib/probe.mjs'
import { appendPitfall } from './lib/pitfalls.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'
import { sleep } from './lib/mcp.mjs'

const { flags } = parseArgs()
const SECONDS = Number(flagOf(flags, 'seconds', '10'))
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const dir = resolve(flagOf(flags, 'o', `.anote/device/${ts}`))
mkdirSync(`${dir}/shots`, { recursive: true })

const out = (r) => console.log(JSON.stringify(r, null, 2))
const fail = (result, reason, extra = {}) => { out({ result, reason, dir, ...extra }); process.exit(result === 'skip' ? 3 : 4) }

// automator 底层健壮性兜底：IDE 广播非 JSON ws 帧时 miniprogram-automator
// Connection.onMessage 会抛未捕获异常（PITFALL-13）——按 degraded 如实出账而非裸崩。
process.once('uncaughtException', (e) => {
  const p = appendPitfall({
    symptom: (e.message ?? '').slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'uncaughtException',
    where: 'device\\.mjs', cause: `automator Connection 底层异常: ${e.message}`,
    fix: 'IDE remote-debug 广播非 JSON 帧时 automator 库崩——重开 IDE 或升级 miniprogram-automator 后重跑',
    ownerAction: '升级 DevTools / miniprogram-automator 版本',
  })
  fail('degraded', `底层连接异常: ${e.message}`, { pitfall: p?.id })
})

// ── 1) 通道：automator 是唯一真机道（MCP 不管真机 evaluate）─────────────
const d = await ProbeDriver.open({ via: 'mcp', needAutomator: true, automatorOpts: {} }).catch((e) => {
  fail('degraded', `IDE 通道不可达: ${e.message}`, { pitfall: e.pitfall?.id })
  throw e
})
const mp = d.mp

// ── 2) remote 拉起（--dump-only 跳过）───────────────────────────────────
// 注：--dump-only 对已 attach 通道直接 dump，不校验物理设备在场——产物如实记 source:'attached-lane'。
//
// 调试窗存活守卫（PITFALL-18）：enableRemoteDebug 让手机进「等调试器」长等态，
// IDE 侧 remote-debug 调试窗不在听时手机永远卡 logo。窗口在开的可探测证据 =
// 最新 WeappLog 里 ws=127.0.0.1:PORT 桥端口仍存活（TCP 可连）。桥不在→拒发 remote。
async function remoteDebugBridgeAlive() {
  try {
    const logRoot = join(homedir(), 'Library/Application Support/微信开发者工具')
    let latestFile = null, latestM = 0
    for (const e of readdirSync(logRoot)) {
      const ld = join(logRoot, e, 'WeappLog/logs')
      if (!existsSync(ld)) continue
      for (const f of readdirSync(ld)) {
        const fp = join(ld, f)
        const m = statSync(fp).mtimeMs
        if (m > latestM) { latestM = m; latestFile = fp }
      }
    }
    if (latestFile === null) return false
    const hits = [...readFileSync(latestFile, 'utf8').matchAll(/ws=127\.0\.0\.1:(\d+)/g)]
    if (hits.length === 0) return false
    const port = Number(hits[hits.length - 1][1])
    return await new Promise((res) => {
      const s = connect({ host: '127.0.0.1', port }, () => { s.end(); res(true) })
      s.on('error', () => res(false))
      setTimeout(() => { s.destroy(); res(false) }, 3000)
    })
  } catch { return false }
}

if (flags['dump-only'] !== true) {
  const REMOTE_TIMEOUT = Number(flagOf(flags, 'remote-timeout', '45000'))
  // 先探当前对端：remote-debug 已连时 App.* 直接路由到真机——brand≠devtools 即是。
  // 已连状态下重发 enableRemoteDebug 会重置会话致窗口空转（实测坑），只在未连时触发。
  let dev = await mp.evaluate(() => wx.getDeviceInfo()).catch(() => null)
  const needRemote = !dev || dev.brand === 'devtools' || dev.platform === 'devtools'
  if (needRemote && !(await remoteDebugBridgeAlive())) {
    await d.close().catch(() => {})
    fail('skip', 'remote-debug 调试窗不在听（WeappLog 无存活 ws 桥）——发 enableRemoteDebug 只会把手机吊进 logo 等待态。请先在 DevTools 开真机调试窗再重跑', { machineReason: 'debugger-window-absent' })
  }
  for (let attempt = 0; attempt < 2 && (!dev || dev.brand === 'devtools' || dev.platform === 'devtools'); attempt++) {
    if (attempt === 1) {
      // 首轮事件未至：Tool.disableRemoteDebug 复位半开会话（裸 Tool 域命令实测可用）再重试
      await mp.send('Tool.disableRemoteDebug').catch(() => {})
      await sleep(1500)
    }
    try {
      // 真信号 = Tool.onRemoteDebugConnected 事件；remote() send 响应超时是 IDE 假超时，不 await。
      mp.remote(true).catch(() => {})
      await new Promise((res, rej) => {
        mp.connection.once('Tool.onRemoteDebugConnected', res)
        setTimeout(() => rej(new Error('remote-timeout')), REMOTE_TIMEOUT)
      })
    } catch (e) {
      if (e.message !== 'remote-timeout') {
        await d.close().catch(() => {})
        // 在场但 remote 失败 → degraded + pitfalls 当轮登记
        const p = appendPitfall({
          symptom: e.message.slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          where: 'device\\.mjs.*remote', cause: `mp.remote(true) 在场失败: ${e.message}`,
          fix: '检查设备 USB/真机调试授权、IDE 真机调试开关；随后重跑 device.mjs --remote',
          ownerAction: '确认真机已在 DevTools 真机调试面板可见后重试',
        })
        fail('degraded', `remote 拉起失败（设备在场语义）: ${e.message}`, { pitfall: p.id })
      }
      console.log(`[device] remote 第${attempt + 1}轮事件未至${attempt === 0 ? '，复位重试' : ''}`)
    }
    dev = await mp.evaluate(() => wx.getDeviceInfo()).catch(() => null)
  }
  if (!dev || dev.brand === 'devtools' || dev.platform === 'devtools') {
    // 解救：失败的 enable 可能已把手机吊进「等调试器」长等态——退出前 disable 放回
    await mp.send('Tool.disableRemoteDebug').catch(() => {})
    await d.close().catch(() => {})
    fail('skip', `物理设备缺席：两轮 remote(${REMOTE_TIMEOUT}ms) 均无 onRemoteDebugConnected`, { machineReason: 'device-absent' })
  }
  out({ result: 'remote-connected', device: `${dev.brand}/${dev.model} ${dev.system}`, dir })
}

// ── 3) 四件套 dump + 内容断言 ────────────────────────────────────────────
const assertions = {}
try {
  // console 采集（真机唯一 console 道：同一 ws 推送）
  const logLines = []
  mp.on('console', (m) => logLines.push(`[${new Date().toISOString()}] ${m.type ?? 'log'} ${m.args?.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`))
  mp.on('exception', (e) => logLines.push(`[${new Date().toISOString()}] exception ${e.message ?? JSON.stringify(e)}`))

  // diag.json：v2 全段
  const diag = await mp.evaluate('() => getApp().globalData.__diagnostics(undefined, true)')
  writeFileSync(`${dir}/diag.json`, JSON.stringify(diag, null, 2))
  assertions.diagV2 = diag?.schema === 'dsh-mini.diag.v2'
  assertions.diagSections = Boolean(diag?.storage?.all) && Array.isArray(diag?.vfs?.objects) && Array.isArray(diag?.errors?.all)

  // storage.json
  const storageDump = await mp.evaluate(`() => { const i = wx.getStorageInfoSync(); const o = {}; for (const k of i.keys) { const s = wx.getStorageSync(k); const j = JSON.stringify(s); o[k] = j.length > 8192 ? j.slice(0, 8192) + '…<truncated>' : s } return { keys: i.keys, currentSize: i.currentSize, all: o } }`)
  writeFileSync(`${dir}/storage.json`, JSON.stringify(storageDump, null, 2))
  assertions.storageKeys = (storageDump?.keys?.length ?? 0) > 0

  // shots/
  await mp.screenshot({ path: `${dir}/shots/shot-0.png` })
  const { readdirSync } = await import('node:fs')
  assertions.shots = readdirSync(`${dir}/shots`).filter((f) => f.endsWith('.png')).length > 0

  // console.log：采集窗口内的事件 + 头部摘要（保非空）
  await sleep(SECONDS * 1000)
  const page = await mp.currentPage().catch(() => null)
  logLines.unshift(`[${new Date().toISOString()}] device-dump route=${page?.path ?? '?'} window=${SECONDS}s`)
  writeFileSync(`${dir}/console.log`, logLines.join('\n') + '\n')
  assertions.consoleLog = logLines.length > 0 && /^\[\d{4}-/.test(logLines[0])
} catch (e) {
  const p = appendPitfall({
    symptom: e.message.slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    where: 'device\\.mjs.*dump', cause: `dump 四件套采集失败: ${e.message}`,
    fix: '确认真机会话存活后重跑；evaluate 失败多半是 remote 会话掉线',
  })
  await d.close().catch(() => {})
  fail('degraded', `dump 失败: ${e.message}`, { pitfall: p.id, assertions })
}

await d.close().catch(() => {})
const failed = Object.entries(assertions).filter(([, v]) => v !== true).map(([k]) => k)
if (failed.length) fail('degraded', `dump 内容断言未过: ${failed.join(',')}`, { assertions })
out({ result: 'pass', source: flags['dump-only'] ? 'attached-lane' : 'remote-connected', dir, assertions, files: ['diag.json', 'storage.json', 'console.log', 'shots/'] })
process.exit(0)
