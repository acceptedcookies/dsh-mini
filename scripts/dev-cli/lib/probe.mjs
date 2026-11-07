// dev-cli · ProbeDriver（T-O-1 / AI 增强形态）：择路/会话/锚解析/等待链/mock 登记 唯一实现点。
//
//  择路表（写死一处，按「能力→通道」；--via 仅调试覆写）：
//    模拟器操作/观测（act/inject/observe/page/clear_cache/preview）→ MCP
//    状态/测试号/doctor（一次性只读）                              → skill
//    真机 remote/console 事件监听                                  → automator
//    生命周期（login/upload/cli-misc/auto-replay）                 → CLI
//    IDE 内置 AI agent（chat/render/card）                         → agent
//
//  通道：
//    mcp        wechatide mcp --token（stdio JSON-RPC，49 工具）
//    skill      wechatide -c <client> <tool>（一次性，AI 增强新增）
//    automator  miniprogram-automator ws（真机 console/remote）
//    cli        Contents/MacOS/cli（生命周期/agent/auto-replay）
//    agent      cli agent（非确定性，探索用）
//
//  会话契约：open() 按择路建通道；一个 Driver 实例跨动作复用同一桥（摊薄冷启）；
//  close() 先 restore 全部 mockWx 再收 automator 再杀 MCP 桥。
//  skill 通道失败 → 自动回落 MCP（fallback=true，默认）。
import { readFileSync } from 'node:fs'
import { McpClient, sleep } from './mcp.mjs'
import { connectIde, pipeConsole } from './ide.mjs'
import { wrapError } from './pitfalls.mjs'
import { PROJECT, REPO_ROOT } from './args.mjs'
import { SkillChannel, AgentChannel, CliChannel } from './channels.mjs'
import { loadCatalog, toolByName } from './catalog.mjs'
import { pollTask, awaitTask } from './tasks.mjs'
import { doctor as runDoctor } from './doctor.mjs'

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
  'status': 'skill', 'doctor': 'skill', 'testaccount': 'skill',
  'catalog': 'mcp', 'task': 'mcp',
  'agent': 'agent', 'agent.chat': 'agent', 'agent.render': 'agent',
}

/** via 覆写仅调试用途：'mcp'|'skill'|'automator'|'cli'|'agent' 直选；'auto'≈automator；undefined 走表。 */
export function laneFor(capability, via) {
  if (via === 'auto') return 'automator'
  if (via === 'mcp' || via === 'skill' || via === 'automator' || via === 'cli' || via === 'agent') return via
  return LANE_TABLE[capability] ?? 'mcp'
}

export function loadAnchors(path = ANCHORS_PATH) {
  const reg = JSON.parse(readFileSync(path, 'utf8'))
  return reg.anchors ?? reg
}

export class ProbeDriver {
  #mcp = null
  #skill = null
  #agent = null
  #cli = null
  #mp = null
  #mpInfo = null
  #anchors
  #mocks = []          // wx_api mock 登记：{ method }
  #catalog = null
  via
  stats = { mcpCalls: 0, skillCalls: 0, agentCalls: 0, automatorCalls: 0, actions: 0, tasks: 0 }

  static async open({
    tool, via, channel, quiet = true, needAutomator = false,
    automatorOpts = {}, skillOpts = {}, agentOpts = {}, cliOpts = {},
    project = PROJECT, fallback = true,
  } = {}) {
    const chosen = channel ?? via ?? laneFor(tool)
    const d = new ProbeDriver()
    d.via = chosen
    d.#anchors = loadAnchors()
    const opts = { quiet, needAutomator, automatorOpts, skillOpts, agentOpts, cliOpts, project }
    try {
      await d.#openChannel(chosen, opts)
    } catch (e) {
      if (fallback && chosen === 'skill') {
        d.via = 'mcp'
        await d.#openChannel('mcp', opts)
      } else {
        throw e
      }
    }
    return d
  }

  async #openChannel(via, opts) {
    if (via === 'skill') {
      this.#skill = await SkillChannel.open({ quiet: opts.quiet, ...opts.skillOpts })
      return
    }
    if (via === 'agent') {
      this.#agent = await AgentChannel.open({ quiet: opts.quiet, ...opts.agentOpts })
      return
    }
    if (via === 'cli') {
      this.#cli = CliChannel.open({ project: opts.project, ...opts.cliOpts })
      return
    }
    if (via === 'automator' || via === 'auto' || opts.needAutomator) {
      await this.automator(opts.automatorOpts)
      if (via !== 'automator' && via !== 'auto') this.#mcp = await McpClient.open({ quiet: opts.quiet })
      return
    }
    this.#mcp = await McpClient.open({ quiet: opts.quiet })
  }

  get mcp() { return this.#mcp }
  get skill() { return this.#skill }
  get agent() { return this.#agent }
  get cli() { return this.#cli }
  get mp() { return this.#mp }
  get mpInfo() { return this.#mpInfo }
  get channel() { return this.via }

  /** 惰性 automator：仅 device/console/remote 需求拉起；复用已连接的会话。 */
  async automator(opts = {}) {
    if (this.#mp) return this.#mp
    const r = await connectIde(opts)
    this.#mp = r.mp
    this.#mpInfo = r
    this.stats.automatorCalls++
    return this.#mp
  }

  // ── 工具通道 ────────────────────────────────────────────────────

  /** 底层 text 调用（带坑匹配出口）。mcp/skill 双通道。 */
  async text(tool, args = {}, opts) {
    if (this.#mcp) {
      this.stats.mcpCalls++
      return this.#mcp.text(tool, args, opts)
    }
    if (this.#skill) {
      this.stats.skillCalls++
      return this.#skill.text(tool, args, opts)
    }
    throw new Error(`text(${tool}) 无工具通道——用 open({via:'mcp'|'skill'})`)
  }

  /** 原始调用：MCP 返回 JSON-RPC 响应；skill 归一为 {result:{content,structuredContent,...}}。 */
  async call(tool, args = {}, opts) {
    if (this.#mcp) {
      this.stats.mcpCalls++
      return this.#mcp.call(tool, args, opts)
    }
    if (this.#skill) {
      this.stats.skillCalls++
      const r = await this.#skill.call(tool, args, opts)
      if (r.ok === false) {
        const e = new Error(r.error ?? r.message ?? `skill-call ${tool} failed`)
        e.tool = tool
        throw wrapError(e, `skill.${tool}`)
      }
      const value = r.result ?? r
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      return {
        result: {
          content: [{ type: 'text', text }],
          structuredContent: value,
          ...(typeof value === 'object' && value !== null ? value : {}),
        },
        ok: true,
        warnings: r.warnings ?? [],
        raw: r,
      }
    }
    throw new Error(`call(${tool}) 无工具通道——用 open({via:'mcp'|'skill'})`)
  }

  /** fnSource 顶层 await 自动包 promise 链的护栏由调用方负责；此处原样透传。 */
  async eval(fnSource, opts) {
    if (this.#mcp) {
      this.stats.mcpCalls++
      try {
        return await this.#mcp.eval(fnSource, opts)
      } catch (e) {
        throw wrapError(e, 'evaluate')
      }
    }
    if (this.#skill) {
      this.stats.skillCalls++
      const r = await this.#skill.text('automation_evaluate', { fnSource }, opts)
      // skill envelope: {success, result:{result}}；与 McpClient.eval 同口径解两层
      const v = r?.result !== undefined ? r.result : r
      return v?.result !== undefined ? v.result : v
    }
    if (this.#mp) {
      // automator 的 evaluate 接受函数或函数字符串（内部 fn.toString()）
      return this.#mp.evaluate(fnSource)
    }
    throw new Error('eval() 无通道——用 open({via:\'mcp\'|\'skill\'|\'automator\'})')
  }

  /** skill-cli 直调（不依赖 MCP 桥）。 */
  async skillCall(tool, args = {}, opts) {
    if (!this.#skill) throw new Error('skillCall() 需要 open({via:\'skill\'})')
    this.stats.skillCalls++
    return this.#skill.call(tool, args, opts)
  }

  async skillText(tool, args = {}, opts) {
    if (!this.#skill) throw new Error('skillText() 需要 open({via:\'skill\'})')
    this.stats.skillCalls++
    return this.#skill.text(tool, args, opts)
  }

  /** IDE 内置 agent（非确定性，探索用）。 */
  async agentRun(subcommand, args = [], opts) {
    if (!this.#agent) throw new Error('agentRun() 需要 open({via:\'agent\'})')
    this.stats.agentCalls++
    return this.#agent.run(subcommand, args, opts)
  }

  // ── 目录 / 任务 / 诊断 ─────────────────────────────────────────

  /** 工具目录（MCP 可用则合并 skill；否则 skill-only）。refresh 强制重取。 */
  async catalog({ refresh = false } = {}) {
    if (this.#catalog !== null && !refresh) return this.#catalog
    if (this.#mcp) this.#catalog = await loadCatalog({ mcp: this.#mcp })
    else this.#catalog = await loadCatalog({ via: 'skill' })
    return this.#catalog
  }

  async tools() {
    return (await this.catalog()).map((t) => t.name)
  }

  async tool(name) {
    return toolByName(await this.catalog(), name)
  }

  /** 异步任务轮询（polling_task_result）。 */
  async task(taskId, opts) {
    this.stats.tasks++
    return pollTask(this, taskId, opts)
  }

  /** 工具返回体 → 自动提取 taskId 并轮询。 */
  async awaitTask(response, opts) {
    this.stats.tasks++
    return awaitTask(this, response, opts)
  }

  /** 测试号 / 登录 ticket 管理（skill 优先）。 */
  async testaccount(action, opts = {}) {
    return this.text('automation_testaccount', { action, ...opts })
  }

  /** 健康检查（doctor 纯 Node + 可选 probe）。 */
  async doctor(opts = {}) {
    return runDoctor(opts)
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
    if (this.#mp && !this.#mcp && !this.#skill) {
      return this.#mp.evaluate(() => getCurrentPages().pop().route)
    }
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
    if (this.#mp && !this.#mcp && !this.#skill) {
      return this.#mp.evaluate(`() => getApp().globalData.__diagnostics(undefined, ${full})`)
    }
    const r = await this.eval(`() => getApp().globalData.__diagnostics(undefined, ${full})`)
    return r?.result !== undefined ? r.result : r
  }

  // ── 生命周期 ────────────────────────────────────────────────────

  async nav(action, url, extra = {}) {
    // automator-only 通道：直接走 MiniProgram 导航方法（legacy/真机）
    if (this.#mp && !this.#mcp && !this.#skill) {
      const fn = this.#mp[action]
      if (typeof fn === 'function') {
        try { await fn.call(this.#mp, url) } catch (e) { throw wrapError(e, `automator.${action}`) }
        await sleep(800)
        return { nav: 'automator', route: await this.route().catch(() => '?') }
      }
    }
    const r = await this.call('automation_navigate', {
      action, ...(url !== undefined ? { url } : {}), ...extra,
    }).catch((e) => ({ navTimeout: wrapError(e, 'automation_navigate').message }))
    if (r?.navTimeout) console.log('nav 响应超时（可能已跳转），回报当前 route…')
    await sleep(800)
    const route = await this.route().catch(() => '?')
    return { nav: r?.navTimeout ?? r, route }
  }

  async refresh(wait = 6000) {
    const r = await this.call('simulator_refresh', {})
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

  pipeConsole(mp = this.#mp) {
    if (!mp) throw new Error('pipeConsole() 需要 automator 通道（open({via:\'automator\'})）')
    return pipeConsole(mp)
  }

  async close() {
    for (const m of [...this.#mocks]) {
      await this.restoreWx(m.method).catch((e) => console.log(`[probe] restore ${m.method} 失败: ${e.message}`))
    }
    this.#mocks = []
    if (this.#mp) await this.#mp.disconnect().catch(() => {})
    if (this.#mcp) this.#mcp.close()
    this.#skill?.close()
    this.#agent?.close()
  }
}
