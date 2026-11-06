// dev-cli · 真机链路：remote 拉起 → 四件套 dump（T-O-5）。
// 用法:
//   node scripts/dev-cli/device.mjs --remote            真机调试拉起 + dump
//   node scripts/dev-cli/device.mjs --dump-only        不拉起，对当前 attach 通道直接 dump
//   node scripts/dev-cli/device.mjs --seconds 15       console 采集时长（默认 10s）
//
// 产物: .anote/device/<ts>/{diag.json, storage.json, console.log, shots/*.png}
// 出口: 0=pass  3=skip(物理设备缺席，机器可读 reason)  4=degraded(设备在场但 remote/dump 失败)
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// ── 1) 通道：automator 是唯一真机道（MCP 不管真机 evaluate）─────────────
const d = await ProbeDriver.open({ via: 'automator', automatorOpts: {} }).catch((e) => {
  fail('degraded', `automator 通道不可达: ${e.message}`, { pitfall: e.pitfall?.id })
  throw e
})
const mp = d.mp

// ── 2) remote 拉起（--dump-only 跳过）───────────────────────────────────
if (flags['dump-only'] !== true) {
  const REMOTE_TIMEOUT = Number(flagOf(flags, 'remote-timeout', '45000'))
  try {
    await Promise.race([
      mp.remote(true),
      (async () => { await sleep(REMOTE_TIMEOUT); throw new Error('remote-timeout') })(),
    ])
  } catch (e) {
    await d.close().catch(() => {})
    if (e.message === 'remote-timeout') {
      fail('skip', `物理设备缺席：remote(${REMOTE_TIMEOUT}ms) 无 onRemoteDebugConnected`, { machineReason: 'device-absent' })
    }
    // 在场但 remote 失败 → degraded + pitfalls 当轮登记 + AUTO_PORT 降级已由 connectIde 内建
    const p = appendPitfall({
      symptom: e.message.slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      where: 'device\\.mjs.*remote', cause: `mp.remote(true) 在场失败: ${e.message}`,
      fix: '检查设备 USB/真机调试授权、IDE 真机调试开关；随后重跑 device.mjs --remote',
      ownerAction: '确认真机已在 DevTools 真机调试面板可见后重试',
    })
    fail('degraded', `remote 拉起失败（设备在场语义）: ${e.message}`, { pitfall: p.id })
  }
  out({ result: 'remote-connected', dir })
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
  const storageDump = await mp.evaluate(`() => { const i = wx.getStorageInfoSync(); const o = {}; for (const k of i.keys) o[k] = wx.getStorageSync(k); return { keys: i.keys, currentSize: i.currentSize, all: o } }`)
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
out({ result: 'pass', dir, assertions, files: ['diag.json', 'storage.json', 'console.log', 'shots/'] })
