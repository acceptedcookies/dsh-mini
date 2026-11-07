// DevTools automator。只连接，不关闭开发者工具。
import { connectIde } from '../../../scripts/dev-cli/lib/ide.mjs'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { fail } from './errors.mjs'

export async function openApp({ device = false } = {}) {
  const ide = await connectIde({ port: Number(process.env.AUTO_PORT ?? 9602) })
  const mp = ide.mp
  const attached = device ? await attachDevice(mp) : null
  const page = await currentPage(mp)
  return {
    device: attached,
    via: ide.via,
    port: ide.port,
    mp,
    page,
    async relaunch(url = '/pages/workspace/workspace') {
      await mp.reLaunch(url)
      this.page = await currentPage(mp)
      return this.page
    },
    async navigate(url) {
      const here = await currentPage(mp).catch(() => null)
      if (here !== null && here.path !== 'pages/workspace/workspace') {
        try { await mp.reLaunch('/pages/workspace/workspace') } catch { /* retry below */ }
      }
      try { await mp.navigateTo(url) } catch (e) {
        if (!/timeout/i.test(String(e?.message ?? e))) throw e
      }
      const want = url.replace(/^\//, '')
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        this.page = await currentPage(mp)
        if (this.page.path === want || this.page.path.endsWith(want)) return this.page
        await new Promise((r) => setTimeout(r, 250))
      }
      throw new Error(`导航未到达 ${want}，当前 ${this.page?.path}`)
    },
    async data() {
      return this.page.data()
    },
    async path() {
      return this.page.path
    },
    async call(method, ...args) {
      return this.page.callMethod(method, ...args)
    },
    async tap(selector) {
      const el = await this.page.$(selector)
      if (!el) throw new Error(`找不到 ${selector}`)
      return el.tap()
    },
    async setData(data) {
      // automator 的 Page.setData 是独立 RPC；不能走 Page.callMethod('setData')
      //（真机报 this.setData is not a function）。
      return this.page.setData(data)
    },
    async eval(fn) {
      return mp.evaluate(fn)
    },
    async shot(file) {
      await mp.screenshot({ path: file })
      return file
    },
    async close() {
      // 断开 automator 会话，不 quit 开发者工具。
      try { await mp.disconnect?.() } catch { /* already gone */ }
      if (ide.proc !== undefined && ide.proc.exitCode === null) ide.proc.kill('SIGTERM')
    },
  }
}

async function attachDevice(mp) {
  const log = (msg) => console.log(`[attachDevice] ${msg}`)
  const info = async () => mp.evaluate(() => {
    const d = wx.getDeviceInfo()
    return { brand: d.brand, model: d.model, platform: d.platform, system: d.system }
  }).catch(() => null)
  let dev = await info()
  log(`initial: ${dev ? `${dev.brand}/${dev.model}/${dev.platform}` : 'null'}`)
  if (dev && dev.brand !== 'devtools' && dev.platform !== 'devtools') return dev

  // 守卫（PITFALL-31）：桥存活 = 存在手动"真机调试"会话（绑 IDE 窗口），automator 永远看不见。
  // 此时发 remote() 会顶掉手动会话 → 手机黑屏/cmdId 1006。必须拒绝并给出可执行指引。
  const bp = bridgePort()
  const alive = bp !== null && (await tcpAlive(bp))
  log(`bridge: ${bp ?? 'none'} alive=${alive}`)
  if (alive) {
    throw fail('sim.attachDevice', new Error(
      `检测到手动真机调试会话（桥 ws=127.0.0.1:${bp} 存活），automator 不可见。` +
      `请先关闭 DevTools 的手动"真机调试"窗口并让手机退出调试态，再重跑；` +
      `不要发 remote()——会顶掉手动会话致手机黑屏。`
    ))
  }

  log('no live bridge → mp.remote(true)（不 await，等 onRemoteDebugConnected，窗口 90s）')
  mp.remote(true).catch(() => {})
  const ev = await new Promise((resolve) => {
    mp.connection.once('Tool.onRemoteDebugConnected', () => resolve('connected'))
    setTimeout(() => resolve('timeout'), 90000)
  })
  log(`remote event: ${ev}`)
  dev = await info()
  log(`after remote: ${dev ? `${dev.brand}/${dev.model}/${dev.platform}` : 'null'}`)
  if (!dev || dev.platform === 'devtools' || dev.brand === 'devtools') {
    // 超时必须释放，否则手机被留在「等调试器」长等态（黑屏、连 logo 都没有）。
    await mp.send('Tool.disableRemoteDebug').catch(() => {})
    log('released phone (Tool.disableRemoteDebug)')
    throw fail('sim.attachDevice', new Error(
      `remote 未连上（event=${ev}）。auto 模式应自动唤醒手机并入会；若失败多为 IDE 状态损坏。` +
      `已发 disableRemoteDebug 释放手机。`
    ))
  }
  return dev
}

/** 扫最近 12 个 WeappLog 找 remote-debug 桥端口（不能只看 mtime 最新文件：新窗空日志会误判）。 */
function bridgePort() {
  try {
    const logRoot = join(homedir(), 'Library/Application Support/微信开发者工具')
    const files = []
    for (const e of readdirSync(logRoot)) {
      const ld = join(logRoot, e, 'WeappLog/logs')
      if (!existsSync(ld)) continue
      for (const f of readdirSync(ld)) {
        const fp = join(ld, f)
        files.push({ fp, m: statSync(fp).mtimeMs })
      }
    }
    files.sort((a, b) => b.m - a.m)
    for (const { fp } of files.slice(0, 12)) {
      const hits = [...readFileSync(fp, 'utf8').matchAll(/ws=127\.0\.0\.1:(\d+)/g)]
      if (hits.length > 0) return Number(hits[hits.length - 1][1])
    }
    return null
  } catch { return null }
}

function tcpAlive(port) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port })
    s.on('connect', () => { s.end(); resolve(true) })
    s.on('error', () => resolve(false))
    setTimeout(() => { s.destroy(); resolve(false) }, 3000)
  })
}

async function currentPage(mp) {
  const page = await mp.currentPage()
  if (page === null || page === undefined) throw new Error('DevTools 没有当前页面')
  return page
}
