/** dev-cli · DevTools 元数据与凭证解析（AI 增强形态的单一真源）。
 *
 *  2.02.2609250 起 DevTools 同时提供：
 *    - MCP stdio 桥（wechatide mcp --token）—— 49 工具，MCP Token 强制
 *    - skill-cli（wechatide -c <client> <tool>）—— 一次性工具调用，CLI Token 可选
 *    - 官方 CLI v2（Contents/MacOS/cli）—— login/preview/upload/auto/agent/auto-replay
 *    - IDE 内置 agent（cli agent ...）—— 非确定性 AI 面
 *
 *  本模块只做「读元数据 + 解析凭证来源」，不发起任何 IDE 调用。
 *  凭证值永不打印：doctor 只报 present/source。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from './args.mjs'

export const DEVTOOLS_APP = process.env.WXIDE_APP ?? '/Applications/wechatwebdevtools.app'
export const WECHATIDE_BIN = process.env.WXIDE_BIN ?? 'wechatide'
export const DEVTOOLS_PKG = join(DEVTOOLS_APP, 'Contents/Resources/app.asar.unpacked/package.json')
export const CLI_PATH = process.env.WXIDE_CLI_PATH ?? join(DEVTOOLS_APP, 'Contents/MacOS/cli')
export const SKILL_DIR = process.env.WXIDE_SKILL_DIR ?? join(DEVTOOLS_APP, 'Contents/Resources/app.asar.unpacked/wechatide-skill')
export const SKILL_MD = join(SKILL_DIR, 'SKILL.md')
export const SKILL_YAML = join(SKILL_DIR, 'skill.yaml')
export const SKILL_TOOLS = join(SKILL_DIR, 'wechatide-tools/references/tools.yaml')

export const MCP_TOKEN_ENV = 'WXIDE_MCP_TOKEN'
export const CLI_TOKEN_ENV = 'WXIDE_CLI_TOKEN'
export const CLIENT_ENV = 'WXIDE_CLIENT_NAME'
export const DEFAULT_CLIENT = 'dsh-dev-cli'
/** AGENTS.md §6 登记的默认 MCP Token（仅本地开发；生产请用 WXIDE_MCP_TOKEN 覆盖）。 */
export const DEFAULT_MCP_TOKEN = 'gckjyDjGMk0RjhIpXpz706E37mrXw2k8'

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/** wechatide skill-cli 二进制（PATH 或 WXIDE_BIN）。 */
export function wechatideInfo() {
  const r = spawnSync('which', [WECHATIDE_BIN], { encoding: 'utf8' })
  const path = r.status === 0 ? String(r.stdout).trim() : ''
  return { bin: WECHATIDE_BIN, available: path !== '', path }
}

/** DevTools 安装包版本（app.asar.unpacked/package.json 是权威；Info.plist 只有 Electron 版本）。 */
export function devtoolsInfo() {
  const pkg = readJson(DEVTOOLS_PKG)
  if (pkg !== null) {
    return {
      app: DEVTOOLS_APP,
      installed: true,
      version: pkg.version ?? '',
      product: pkg.product_string ?? pkg.productName ?? 'wechatwebdevtools',
      buildTime: typeof pkg.buildTime === 'number' ? pkg.buildTime : undefined,
      buildTimeIso: typeof pkg.buildTime === 'number' ? new Date(pkg.buildTime).toISOString() : undefined,
      arch: pkg.archType ?? '',
      source: 'app.asar.unpacked/package.json',
    }
  }
  return { app: DEVTOOLS_APP, installed: existsSync(DEVTOOLS_APP), version: '', source: 'missing' }
}

/** skill 包版本：SKILL.md frontmatter 优先（skill.yaml 只是镜像）。 */
export function skillInfo() {
  let version = ''
  let source = 'missing'
  try {
    const md = readFileSync(SKILL_MD, 'utf8')
    const fm = /^---\s*\n([\s\S]*?)\n---/.exec(md)?.[1] ?? ''
    version = /^version:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? ''
    if (version !== '') source = 'SKILL.md'
  } catch { /* fall through */ }
  if (version === '') {
    try {
      const y = readFileSync(SKILL_YAML, 'utf8')
      version = /^version:\s*(.+)$/m.exec(y)?.[1]?.trim() ?? ''
      if (version !== '') source = 'skill.yaml'
    } catch { /* missing */ }
  }
  return {
    dir: SKILL_DIR,
    installed: existsSync(SKILL_MD),
    version,
    source,
    skillMd: SKILL_MD,
    toolsYaml: SKILL_TOOLS,
  }
}

/** skill 工具注册表（tools.yaml 实为 JSON；49 工具 + defaults）。 */
export function readSkillTools() {
  const j = readJson(SKILL_TOOLS)
  return j ?? { defaults: {}, tools: [] }
}

/** MCP Token：env 优先，回落 AGENTS.md 登记值。 */
export function mcpToken() {
  const env = process.env[MCP_TOKEN_ENV]
  if (typeof env === 'string' && env.length > 0) return env
  return DEFAULT_MCP_TOKEN
}

export function mcpTokenSource() {
  return process.env[MCP_TOKEN_ENV] ? 'env' : 'agents-md-default'
}

/** skill-cli 的 CLI Token（可选；未配置时 skill-cli 不验）。 */
export function cliToken() {
  return process.env[CLI_TOKEN_ENV] ?? ''
}

export function cliTokenSource() {
  return process.env[CLI_TOKEN_ENV] ? 'env' : 'none'
}

/** skill-cli 的 clientName（须与 IDE 授权弹窗一致；同一会话内不变）。 */
export function clientName() {
  return process.env[CLIENT_ENV] ?? DEFAULT_CLIENT
}

/** 凭证面摘要——只报 present/source，永不返回值。 */
export function tokenInfo() {
  return {
    mcp: { present: mcpToken().length > 0, source: mcpTokenSource() },
    cli: { present: cliToken().length > 0, source: cliTokenSource() },
    client: clientName(),
  }
}

function readText(path) {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}

/** 项目配置摘要：appid/route/durableUrl（doctor 用；不加载 TS 运行时）。 */
export function projectInfo(root = REPO_ROOT) {
  const pub = readJson(join(root, 'project.config.json')) ?? {}
  const priv = readJson(join(root, 'project.private.config.json')) ?? {}
  const appJson = readJson(join(root, 'app.json')) ?? {}
  const devConfig = readText(join(root, 'services/fx/dev-config.ts'))
  const route = appJson?.dsh?.localRuntimeRoute
    ?? /export const route[^=]*=\s*['"]([^'"]+)['"]/.exec(devConfig)?.[1]
    ?? ''
  const durableUrl = /"durableUrl"\s*:\s*"([^"]*)"/.exec(devConfig)?.[1]
    ?? /durableUrl\s*:\s*['"]([^'"]+)['"]/.exec(devConfig)?.[1]
    ?? ''
  return {
    root,
    appid: pub.appid ?? priv.appid ?? '',
    projectname: pub.projectname ?? '',
    route,
    durableUrl,
    cloud: appJson?.cloud === true,
    miniprogramRoot: pub.miniprogramRoot ?? '',
  }
}
