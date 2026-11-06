// dev-cli · ProbeDriver（T-O-1）：择路/会话/锚解析/等待链/mock 登记 唯一实现点。
//
//  择路表（写死一处，按「能力→通道」；--via 仅调试覆写）：
//    模拟器操作/观测（act/inject/observe/page/clear_cache/preview）→ MCP
//    真机 remote/console 事件监听                              → automator
//    生命周期（login/upload/cli-misc）                          → CLI 直通
//
//  会话契约：open() 立 MCP 桥（automator 惰性——仅 device/console 需求拉起）；
//  一个 Driver 实例跨动作复用同一桥（摊薄 ~8s 冷启）；close() 先 restore
//  全部 mockWx 再收 automator 再杀 MCP 桥。首轮不做自动重连（如实上抛）。
import { readFileSync } from 'node:fs'
import { McpClient, sleep } from './mcp.mjs'
import { connectIde, pipeConsole } from './ide.mjs'
import { wrapError } from './pitfalls.mjs'
import { PROJECT, REPO_ROOT } from './args.mjs'

export const ANCHORS_PATH = `${REPO_ROOT}/scripts/dev-cli/anchors.json`

/** app.ts:65-83 九枚 globalData 测试钩子——inject.hook 白名单真源。 */
export const HOOK_WHITELIST = new Set([
  '__vfs', '__vfsRemoteFor', '__vfsSyncFor', '__ioStateFor',
  '__hasFreshTicket', '__ensureDurableTicket',
  '__diagnostics', '__errorBus', '__sessionStore',
])

/** 能力 → 通道择路表（唯一写死点）。 */
export const LANE_TABLE = {
  'act': 'mcp', 'inject': 'mcp', 'observe': 'mcp', 'page': 'mcp',
  'clear_cache': 'mcp', 'preview': 'mcp',
  'device.remote': 'automator', 'console.listen': 'automator',
  'lifecycle': 'cli',
}

/** via 覆写仅调试用途：'mcp'|'automator'|'cli' 直选；'auto'≈automator；undefined 走表。 */
export function laneFor(capability, via) {
  if (via === 'auto') return 'automator'
  if (via === 'mcp' || via === 'automator' || via === 'cli') return via
  return LANE_TABLE[capability] ?? 'mcp'
}

export function loadAnchors(path = ANCHORS_PATH) {
  const reg = JSON.parse(readFileSync(path, 'utf8'))
  return reg.anchors ?? reg
}

export class ProbeDriver {
  #mcp = null
  #mp = null
  #mpInfo = null
  #anchors
  #mocks = []          // wx_api mock 登记：{ method }
  via
  stats = { mcpCalls: 0, automatorCalls: 0, actions: 0 }

  static async open({ tool, via, quiet = true, needAutomator = false, automatorOpts = {} } = {}) {
    if (via === undefined) via = laneFor(tool)
    const d = new ProbeDriver()
    d.via = via
    d.#anchors = loadAnchors()
    if (via === 'automator' || via === 'auto' || needAutomator) {
      await d.automator(automatorOpts)
      if (via !== 'automator' && via !== 'auto') d.#mcp = await McpClient.open({ quiet })
    } else {
      d.#mcp = await McpClient.open({ quiet })
    }
    return d
  }

  get mcp() { return this.#mcp }
  get mp() { return this.#mp }
  get mpInfo() { return this.#mpInfo }

  /** 惰性 automator：仅 device/console/remote 需求拉起；复用已连接的会话。 */
  async automator(opts = {}) {
    if (this.#mp) return this.#mp
    const r = await connectIde(opts)
    this.#mp = r.mp
    this.#mpInfo = r
    return this.#mp
  }

  /** 底层 MCP text 调用（带坑匹配出口）。 */
  async text(tool, args = {}, opts) {
    this.stats.mcpCalls++
    return this.#mcp.text(tool, args, opts)
  }

  async call(tool, args = {}, opts) {
    this.stats.mcpCalls++
    return this.#mcp.call(tool, args, opts)
  }

  /** fnSource 顶层 await 自动包 promise 链的护栏由调用方负责；此处原样透传。 */
  async eval(fnSource, opts) {
    this.stats.mcpCalls++
    try {
      return await this.#mcp.eval(fnSource, opts)
    } catch (e) {
      throw wrapError(e, 'evaluate')
    }
  }

  // ── 锚解析 ─────────────────────────────────────────────────────

  /** '@name'|裸 selector → selector；--id 拼 [disc="v"]（wx:for 动态行）。 */
  async resolveAnchor(target, { id, nav = true } = {}) {
    if (!target?.startsWith('@')) return target
    const name = target.slice(1)
    const meta = this.#anchors[name]
    if (!meta) {
      const near = Object.keys(this.#anchors).filter((k) => k.includes(name.split('.').pop() ?? name))
      throw new Error(`anchors.json 无锚 '${name}'${near.length ? `——近似：${near.slice(0, 6).join(', ')}` : ''}`)
    }
    let selector = meta.selector
    if (id !== undefined && meta.disc) selector += `[${meta.disc}="${id}"]`
    // page 为 pages/ 路由时，当前页不符自动导航先行
    if (nav && meta.page?.startsWith('pages/')) {
      const route = await this.route().catch(() => null)
      const want = meta.page.replace(/\.wxml$/, '')
      if (route && route !== want) {
        await this.nav('reLaunch', `/${want}`)
        await sleep(800)
      }
    }
    return selector
  }

  // ── 四原语族 ────────────────────────────────────────────────────

  /** act：元素动作（element_action 18 动作全通）。 */
  async act(target, action, params = {}, { id, wait, waitForSelector } = {}) {
    this.stats.actions++
    const selector = await this.resolveAnchor(target, { id })
    return this.text('automation_element_action', {
      action, selector, ...params,
      ...(wait !== undefined ? { wait } : {}),
      ...(waitForSelector !== undefined ? { waitForSelector } : {}),
    })
  }

  /** page setData patch（对象自动 stringify 为 patch 串）。 */
  async setData(patch) {
    return this.text('automation_page_action', { action: 'setData', patch: JSON.stringify(patch) })
  }

  async getData(dataPath) {
    return this.text('automation_page_action', { action: 'getData', ...(dataPath ? { dataPath } : {}) })
  }

  async callMethod(method, args = []) {
    return this.text('automation_page_action', { action: 'callMethod', method, args })
  }

  /** inject.hook：evaluate 道，限域白名单（禁新挂诊断钩子，T-O-B2）。 */
  async hook(name, fnSource) {
    if (!HOOK_WHITELIST.has(name)) {
      throw new Error(`hook '${name}' 不在白名单（${[...HOOK_WHITELIST].join(' ')}）——禁新挂钩子，回 T-O-B2`)
    }
    return this.eval(fnSource)
  }

  /** mockWx：wx_api mock + 会话登记（close 前配对 restore）。 */
  async mockWx(method, { result, functionDeclaration } = {}) {
    const r = await this.text('automation_wx_api', {
      action: 'mock', method,
      ...(result !== undefined ? { result } : {}),
      ...(functionDeclaration !== undefined ? { functionDeclaration } : {}),
    })
    this.#mocks.push({ method })
    return r
  }

  async callWx(method, args = []) {
    return this.text('automation_wx_api', { action: 'call', method, args })
  }

  async restoreWx(method) {
    const r = await this.text('automation_wx_api', { action: 'restore', method })
    this.#mocks = this.#mocks.filter((m) => m.method !== method)
    return r
  }

  get pendingMocks() { return this.#mocks.map((m) => m.method) }

  // ── 观测 ────────────────────────────────────────────────────────

  async route() {
    return this.eval('() => getCurrentPages().pop().route')
  }

  async runtimeInfo(action = 'systemInfo') {
    return this.text('automation_runtime_info', { action })
  }

  /** 元素几何：element_action offset+size → {x,y,w,h}（dp）。 */
  async elementRect(target, { id } = {}) {
    const selector = await this.resolveAnchor(target, { id })
    const off = await this.text('automation_element_action', { action: 'offset', selector })
    const size = await this.text('automation_element_action', { action: 'size', selector })
    const norm = (v) => {
      const o = v?.result ?? v
      return { x: Number(o?.x ?? o?.left ?? 0), y: Number(o?.y ?? o?.top ?? 0) }
    }
    const o = norm(off)
    const s = size?.result ?? size
    return { x: o.x, y: o.y, w: Number(s?.width ?? s?.w ?? 0), h: Number(s?.height ?? s?.h ?? 0) }
  }

  async shot(path, extra = {}) {
    return this.text('automation_viewport_action', { action: 'screenshot', path, ...extra })
  }

  /** 原始分辨率 PNG（region 裁切基底——optimize:false 保物理像素）。 */
  async rawShot(path, extra = {}) {
    return this.text('simulator_screenshot', { path, optimize: false, ...extra })
  }

  async consoleSnapshot(grep) {
    const command = grep ? `grep -n -i ${JSON.stringify(grep)}` : 'grep -n .'
    return this.text('get_simulator_console', { command })
  }

  async networkSnapshot(grep) {
    const command = grep ? `grep -n -i ${JSON.stringify(grep)}` : 'grep -n .'
    return this.text('get_simulator_network', { command })
  }

  async diag(full = false) {
    const r = await this.eval(`() => getApp().globalData.__diagnostics(undefined, ${full})`)
    return r?.result !== undefined ? r.result : r
  }

  // ── 生命周期 ────────────────────────────────────────────────────

  async nav(action, url, extra = {}) {
    const r = await this.#mcp.navigate(action, url, extra).catch((e) => ({ navTimeout: wrapError(e, 'automation_navigate').message }))
    if (r?.navTimeout) console.log('nav 响应超时（可能已跳转），回报当前 route…')
    await sleep(800)
    const route = await this.route().catch(() => '?')
    return { nav: r?.navTimeout ?? r, route }
  }

  async refresh(wait = 6000) {
    const r = await this.#mcp.refresh()
    await sleep(wait)
    return { refresh: r?.result?.content?.[0]?.text ?? r?.result ?? r, route: await this.route().catch(() => '?') }
  }

  async clearCache(action = 'cleanStorageCache') {
    return this.text('debug_clear_cache', { action })
  }

  async openPage(page, { query, scene } = {}) {
    return this.text('simulator_open_page', { page, ...(query ? { query } : {}), ...(scene ? { scene } : {}) })
  }

  /** 真机拉起：MCP viewport_action remote+auto。 */
  async remoteDevice() {
    return this.text('automation_viewport_action', { action: 'remote', auto: true }, { timeoutMs: 120000 })
  }

  async generateScript(opts = { includeFailed: false }) {
    return this.call('automation_generate_script', opts, { timeoutMs: 60000 })
  }

  pipeConsole(mp = this.#mp) { pipeConsole(mp) }

  async close() {
    for (const m of [...this.#mocks]) {
      await this.restoreWx(m.method).catch((e) => console.log(`[probe] restore ${m.method} 失败: ${e.message}`))
    }
    this.#mocks = []
    if (this.#mp) await this.#mp.disconnect().catch(() => {})
    if (this.#mcp) this.#mcp.close()
  }
}
