/** dev-cli · MCP 通道真源：wechatide mcp --token stdio JSON-RPC 桥。
 *
 *  通道契约（AGENTS.md §6）：
 *    {"mcpServers": { "wechat-devtools": { "command": "wechatide",
 *       "args": ["mcp", "--token=…"] } } }
 *  协议：NDJSON over stdio —— initialize → notifications/initialized → tools/call。
 *  每个 tool 调用的 arguments 须带 project（绝对路径）。
 *
 *  已知坑（本会话实测）：
 *  - automation_evaluate 的 fnSource 禁顶层 await——写 promise 链或 () => expr。
 *  - automation_element_action 的 scrollTo 需同时传 x,y。
 *  - 截图走 automation_viewport_action { action:'screenshot', path }；
 *    simulator_screenshot 是另一条（返回 path+尺寸，默认长边 1280 JPEG）。
 *  - 授权态下 tools/call 返回 -32603 Bad Request：IDE 侧批准授权弹窗后重试。
 *  - simulator_refresh 触发重编译期间 evaluate 会 'timeout waiting for automator
 *    response'——refresh 后留 5-8s 再探。
 */
import { spawn } from 'node:child_process'
import { PROJECT } from './args.mjs'
import { wrapError } from './pitfalls.mjs'
import { mcpToken, clientName } from './devtools.mjs'

/** 兼容导出：旧调用方仍可 import { MCP_TOKEN }。 */
export const MCP_TOKEN = mcpToken()

/** MCP 桥握手计数（L2 会话复用证据：session 内多动作应=1）。 */
export let bridgeCount = 0

export class McpClient {
  static async open({ project = PROJECT, token = mcpToken(), quiet = false, name = clientName() } = {}) {
    const child = spawn('wechatide', ['mcp', `--token=${token}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const c = new McpClient(child, project, { quiet, name })
    await c.#handshake()
    bridgeCount++
    return c
  }

  #child
  #project
  #quiet
  #name
  #buf = ''
  #stderr = ''
  #pending = new Map()
  #seq = 0
  serverInfo = null
  capabilities = null
  initResult = null

  constructor(child, project, { quiet = false, name = clientName() } = {}) {
    this.#child = child
    this.#project = project
    this.#quiet = quiet
    this.#name = name
    child.stdout.on('data', (d) => {
      this.#buf += d.toString()
      let idx
      while ((idx = this.#buf.indexOf('\n')) >= 0) {
        const line = this.#buf.slice(0, idx).trim()
        this.#buf = this.#buf.slice(idx + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id !== undefined && this.#pending.has(msg.id)) {
          this.#pending.get(msg.id)(msg)
          this.#pending.delete(msg.id)
        }
      }
    })
    child.stderr.on('data', (d) => {
      this.#stderr += d.toString()
      if (!this.#quiet) process.stderr.write(d)
    })
    child.on('exit', () => {
      for (const resolve of this.#pending.values()) {
        resolve({ error: { code: -32000, message: 'mcp bridge exited' } })
      }
      this.#pending.clear()
    })
  }

  get stderr() { return this.#stderr }
  get clientName() { return this.#name }

  #send(method, params, id) {
    const frame = { jsonrpc: '2.0', method, params }
    if (id !== undefined) frame.id = id
    this.#child.stdin.write(JSON.stringify(frame) + '\n')
  }

  #rpc(method, params, timeoutMs = 30000) {
    const id = ++this.#seq
    return new Promise((resolve, reject) => {
      this.#pending.set(id, resolve)
      this.#send(method, params, id)
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id)
          reject(wrapError(new Error(`mcp timeout: ${method}`), `mcp.${method}`))
        }
      }, timeoutMs)
    })
  }

  async #handshake() {
    const init = await this.#rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: this.#name, version: '1.0' },
    })
    this.initResult = init?.result ?? init?.error ?? null
    this.serverInfo = init?.result?.serverInfo ?? null
    this.capabilities = init?.result?.capabilities ?? null
    this.#send('notifications/initialized', {}, undefined)
    await new Promise((r) => setTimeout(r, 400))
  }

  /** 协议级 RPC（tools/list、ping 等非 tool 方法走这里）。 */
  rpc(method, params = {}, timeoutMs = 30000) {
    return this.#rpc(method, params, timeoutMs)
  }

  /** tools/list → 原始工具数组。 */
  async tools() {
    const r = await this.rpc('tools/list', {}, 15000)
    return r?.result?.tools ?? []
  }

  /** 单个工具 schema（未找到返回 undefined）。 */
  async tool(name) {
    return (await this.tools()).find((t) => t.name === name)
  }

  /** 原始 tools/call：返回解析后 JSON-RPC 响应。arguments 自动注入 project。
   *  r.error → wrapError 抛出（[PITFALL-n] 前缀，T-O-6）。
   *  -32603 / Bad Request = IDE 侧授权弹窗 pending（PITFALL-1），附加 pendingApproval。 */
  async call(name, args = {}, { timeoutMs = 30000 } = {}) {
    const r = await this.#rpc('tools/call', {
      name,
      arguments: { project: this.#project, ...args },
    }, timeoutMs)
    if (r?.error) {
      const e = new Error(r.error.message ?? JSON.stringify(r.error))
      e.code = r.error.code
      e.tool = name
      if (r.error.code === -32603 || /Bad Request/i.test(e.message)) e.pendingApproval = true
      throw wrapError(e, `mcp.${name}`)
    }
    return r
  }

  /** 便捷：调用并取 content[0].text（多数工具返回 JSON 字符串）。 */
  async text(name, args = {}, opts) {
    const r = await this.call(name, args, opts)
    const t = r?.result?.content?.[0]?.text
    if (typeof t === 'string') {
      try { return JSON.parse(t) } catch { return t }
    }
    return r?.result?.structuredContent ?? r?.error ?? r
  }

  /** automation_evaluate：fnSource 禁顶层 await。返回 evaluate 的 result 体。 */
  async eval(fnSource, opts) {
    const r = await this.text('automation_evaluate', { action: 'evaluate', fnSource }, opts)
    return r?.result?.result !== undefined ? r.result.result : r
  }

  /** 视口截图 → path。 */
  async shot(path, opts) {
    return this.text('automation_viewport_action', { action: 'screenshot', path }, opts)
  }

  /** 页面导航：navigateTo | reLaunch | redirectTo | navigateBack。 */
  async navigate(action, url = undefined, extra = {}) {
    return this.text('automation_navigate', { action, ...(url !== undefined ? { url } : {}), ...extra })
  }

  async refresh() {
    return this.call('simulator_refresh', {})
  }

  async runtimeInfo() {
    return this.text('automation_runtime_info', {})
  }

  close() {
    try { this.#child.stdin.end() } catch {}
    try { this.#child.kill('SIGKILL') } catch {}
    try { this.#child.unref() } catch {}
    this.#pending.clear()
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
