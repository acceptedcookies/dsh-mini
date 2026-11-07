// DevTools automator。只连接，不关闭开发者工具。
import { connectIde } from '../../../scripts/dev-cli/lib/ide.mjs'

export async function openApp() {
  const ide = await connectIde({ port: Number(process.env.AUTO_PORT ?? 9420) })
  const mp = ide.mp
  const page = await currentPage(mp)
  return {
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

async function currentPage(mp) {
  const page = await mp.currentPage()
  if (page === null || page === undefined) throw new Error('DevTools 没有当前页面')
  return page
}
