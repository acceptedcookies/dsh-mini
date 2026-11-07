/** dev-cli · 通道注册表（AI 增强形态的五通道）。
 *
 *  A mcp        wechatide mcp --token        stdio JSON-RPC，49 工具，结构化 schema
 *  B automator  miniprogram-automator ws     真机 console/remote（lib/ide.mjs）
 *  C cli        Contents/MacOS/cli           登录/上传/预览/云/生命周期/agent/auto-replay
 *  D skill      wechatide -c <client> <tool> 一次性工具调用（skill-cli，AI 增强新增）
 *  E agent      cli agent <subcommand>       IDE 内置 AI agent（非确定性，探索用）
 *
 *  本模块只承载 D/E 与 C 的通用 runner；A/B 的桥仍在 lib/mcp.mjs / lib/ide.mjs。
 *  顶层工具禁止自建桥（test/mn04/no-self-bridge.mjs）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { PROJECT } from './args.mjs'
import {
  CLI_PATH, WECHATIDE_BIN, clientName, cliToken, skillInfo, tokenInfo,
} from './devtools.mjs'
import { wrapError } from './pitfalls.mjs'
import { loadSkillCatalog, toolByName } from './catalog.mjs'
import { portAlive } from './ide.mjs'

const NO_PROJECT = new Set(['login', 'islogin', 'quit', 'reset-fileutils', '-h', '--help', '-v', '--version', 'engine'])

function parseJsonLoose(text) {
  const s = String(text ?? '').trim()
  if (s === '') return null
  try { return JSON.parse(s) } catch { /* fallthrough */ }
  // skill-cli 可能在 stdout 混入少量日志——取最后一个平衡的 JSON 对象
  const end = s.lastIndexOf('}')
  if (end === -1) return null
  for (let start = s.lastIndexOf('{', end); start !== -1; start = s.lastIndexOf('{', start - 1)) {
    try { return JSON.parse(s.slice(start, end + 1)) } catch { /* keep shrinking */ }
  }
  return null
}

function pushFlag(argv, key, value) {
  if (value === undefined || value === null) return
  argv.push(`--${key}`)
  if (value === true) return
  // false 必须显式下发（如 simulator_screenshot --optimize false = 原始 PNG）
  argv.push(typeof value === 'object' ? JSON.stringify(value) : String(value))
}

/** skill-cli 参数适配：按 tools.yaml inputSchema 过滤，fixed 字段跳过（CLI 自填）。 */
export function skillArgv(tool, args = {}, { project = PROJECT, skillVersion = '' } = {}) {
  const catalog = loadSkillCatalog()
  const meta = toolByName(catalog, tool)
  const schema = meta?.skillSchema
  const argv = ['-c', clientName(), tool]
  if (schema === undefined) {
    for (const [k, v] of Object.entries(args)) pushFlag(argv, k, v)
    return argv
  }
  for (const [key, field] of Object.entries(schema)) {
    if (field?.fixed === true) continue
    if (key === 'project') {
      if (args.project === false) continue
      pushFlag(argv, 'project', args.project ?? project)
      continue
    }
    if (key === 'skill-version') {
      pushFlag(argv, 'skill-version', args['skill-version'] ?? skillVersion)
      continue
    }
    if (args[key] !== undefined) pushFlag(argv, key, args[key])
  }
  return argv
}

export class SkillChannel {
  static async open({ client = clientName(), token = cliToken(), project = PROJECT, quiet = true } = {}) {
    const c = new SkillChannel({ client, token, project, quiet })
    if (!skillInfo().installed) {
      throw wrapError(new Error(`wechatide-skill 未安装：${skillInfo().dir}`), 'skill.open')
    }
    return c
  }

  #client
  #token
  #project
  #quiet
  #catalog

  constructor({ client, token, project, quiet }) {
    this.#client = client
    this.#token = token
    this.#project = project
    this.#quiet = quiet
    this.#catalog = loadSkillCatalog()
  }

  get client() { return this.#client }
  get project() { return this.#project }
  get catalog() { return this.#catalog }

  /** 一次性 skill-call：返回 { ok, tool, clientName, result, warnings, stderr }。 */
  async call(tool, args = {}, { timeoutMs = 30000 } = {}) {
    const argv = skillArgv(tool, args, { project: this.#project, skillVersion: skillInfo().version })
    if (this.#token.length > 0) argv.push('--token', this.#token)
    const r = await runCapture(WECHATIDE_BIN, argv, { timeoutMs, quiet: this.#quiet })
    const json = parseJsonLoose(r.stdout)
    const warnings = []
    if (/未知参数/.test(r.stderr)) warnings.push(r.stderr.trim().split('\n').filter((l) => /未知参数/.test(l)).join(' '))
    if (json === null) {
      return { ok: false, tool, clientName: this.#client, error: `skill-call bad-json (exit=${r.code})`, stdout: r.stdout, stderr: r.stderr, warnings }
    }
    return { ...json, warnings: [...(json.warnings ?? []), ...warnings], stderr: r.stderr, exitCode: r.code }
  }

  async text(tool, args = {}, opts) {
    const r = await this.call(tool, args, opts)
    if (r.ok === false) {
      throw wrapError(new Error(r.error ?? r.message ?? `skill-call ${tool} failed`), `skill.${tool}`)
    }
    return r.result ?? r
  }

  /** 会话门禁：登录态 / skill 版本关系 / token 要求（只读）。 */
  async status() {
    return this.text('check_wechatide_status', { 'skill-version': skillInfo().version })
  }

  close() { /* 一次性进程，无持久资源 */ }
}

export class AgentChannel {
  static async open({ project = PROJECT, quiet = true } = {}) {
    if (!existsSync(CLI_PATH)) throw wrapError(new Error(`DevTools CLI 不存在：${CLI_PATH}`), 'agent.open')
    return new AgentChannel({ project, quiet })
  }

  #project
  #quiet

  constructor({ project, quiet }) {
    this.#project = project
    this.#quiet = quiet
  }

  get project() { return this.#project }

  /** 通用 agent 子命令 runner。stream=true 时继承 stdio（start 常驻用）。 */
  async run(subcommand, args = [], { timeoutMs = 120000, stream = false } = {}) {
    const argv = ['agent', subcommand, ...args]
    if (!stream && !args.includes('--project')) argv.push('--project', this.#project)
    if (stream) {
      const code = await runInherit(CLI_PATH, argv)
      return { ok: code === 0, code, stdout: '', stderr: '', json: null }
    }
    const r = await runCapture(CLI_PATH, argv, { timeoutMs, quiet: this.#quiet })
    const json = parseJsonLoose(r.stdout)
    return { ok: r.code === 0, code: r.code, stdout: r.stdout, stderr: r.stderr, json }
  }

  async start(opts = {}) { return this.run('start', [], { stream: true, ...opts }) }
  async tool(name, args = {}, opts = {}) {
    return this.run('tool', ['--name', name, '--args', JSON.stringify(args)], opts)
  }
  async chat(query, { sessionId, skill, timeout, ...opts } = {}) {
    const argv = ['--query', query]
    if (sessionId !== undefined) argv.push('--session-id', sessionId)
    if (skill !== undefined) argv.push('--skill', skill)
    if (timeout !== undefined) argv.push('--timeout', String(timeout))
    return this.run('chat', argv, opts)
  }
  async render(name, args = {}, opts = {}) {
    return this.run('render', ['--name', name, '--args', JSON.stringify(args)], opts)
  }
  async cardClick(cardId, opts = {}) { return this.run('card-click', ['--card-id', cardId], opts) }
  async getDom(opts = {}) { return this.run('get-dom', [], opts) }
  async getCardImage(opts = {}) { return this.run('get-card-image', [], opts) }
  async clear(opts = {}) { return this.run('clear', [], opts) }
  async debug(opts = {}) { return this.run('debug', [], opts) }
  async overlay(opts = {}) { return this.run('overlay', [], opts) }
  async detailClose(opts = {}) { return this.run('detail-close', [], opts) }
  close() { /* agent server 由 IDE 管理；不在此强杀 */ }
}

export class CliChannel {
  static open({ project = PROJECT } = {}) {
    if (!existsSync(CLI_PATH)) throw wrapError(new Error(`DevTools CLI 不存在：${CLI_PATH}`), 'cli.open')
    return new CliChannel({ project })
  }

  #project
  constructor({ project }) { this.#project = project }
  get project() { return this.#project }

  /** 官方 CLI 通用 runner：capture=true 返回 {code,stdout,stderr}，否则 inherit。 */
  async run(args = [], { capture = true, timeoutMs = 120000, project = true } = {}) {
    const final = [...args]
    const cmd = final[0] ?? ''
    if (project && !NO_PROJECT.has(cmd) && !final.includes('--project')) final.push('--project', this.#project)
    if (!capture) return { ok: (await runInherit(CLI_PATH, final)) === 0, code: 0, stdout: '', stderr: '' }
    const r = await runCapture(CLI_PATH, final, { timeoutMs, quiet: true })
    return { ok: r.code === 0, ...r }
  }
}

/** 子进程 capture runner（skill/agent/cli 共用；不用于 MCP/automator 桥）。 */
export function runCapture(cmd, args, { timeoutMs = 120000, quiet = true } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      if (!quiet) process.stderr.write(d)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: `${stderr}${e.message}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut })
    })
  })
}

function runInherit(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('error', () => resolve(127))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

/** 通道可用性快照（不发起重调用；probe 由 doctor 负责）。
 *  probeAutomator=false 时跳过 TCP 探活（--offline 用）。 */
export async function channelStatus({ automatorPort = Number(process.env.AUTO_PORT ?? 9420), probeAutomator = true } = {}) {
  const skill = skillInfo()
  const tokens = tokenInfo()
  return {
    mcp: { available: tokens.mcp.present, tokenSource: tokens.mcp.source },
    skill: { available: skill.installed, version: skill.version, dir: skill.dir },
    cli: { available: existsSync(CLI_PATH), path: CLI_PATH },
    automator: probeAutomator
      ? { available: await portAlive(automatorPort), port: automatorPort }
      : { available: false, port: automatorPort, skipped: true },
    agent: { available: existsSync(CLI_PATH), note: 'cli agent（非确定性，探索用）' },
    client: tokens.client,
  }
}
