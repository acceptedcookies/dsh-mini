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

export const MCP_TOKEN = process.env.WXIDE_MCP_TOKEN ?? 'gckjyDjGMk0RjhIpXpz706E37mrXw2k8'

export class McpClient {
  static async open({ project = PROJECT, token = MCP_TOKEN, quiet = false } = {}) {
    const child = spawn('wechatide', ['mcp', `--token=${token}`], {
      stdio: ['pipe', 'pipe', quiet ? 'ignore' : 'inherit'],
    })
    const c = new McpClient(child, project)
    await c.#handshake()
    return c
  }

  #child
  #project
  #buf = ''
  #pending = new Map()
  #seq = 0

  constructor(child, project) {
    this.#child = child
    this.#project = project
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
  }

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
          reject(new Error(`mcp timeout: ${method}`))
        }
      }, timeoutMs)
    })
  }

  async #handshake() {
    await this.#rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-dev-cli', version: '1.0' },
    })
    this.#send('notifications/initialized', {}, undefined)
    await new Promise((r) => setTimeout(r, 400))
  }

  /** 协议级 RPC（tools/list、ping 等非 tool 方法走这里）。 */
  rpc(method, params = {}, timeoutMs = 30000) {
    return this.#rpc(method, params, timeoutMs)
  }

  /** 原始 tools/call：返回解析后 JSON-RPC 响应。arguments 自动注入 project。 */
  call(name, args = {}, { timeoutMs = 30000 } = {}) {
    return this.#rpc('tools/call', {
      name,
      arguments: { project: this.#project, ...args },
    }, timeoutMs)
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
    try { this.#child.kill() } catch {}
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
