/** dev-cli · 本地工具注册表（AI agent 可发现的命令面）。
 *
 *  与 catalog.mjs 的分工：
 *    catalog = DevTools 暴露的工具（49 个）
 *    registry = 本仓 dev-cli 暴露的命令（薄壳 + 新 AI 增强工具）
 *
 *  index.mjs / doctor.mjs / tools.mjs 共用本表。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './args.mjs'

export const REGISTRY_SCHEMA = 'dsh-mini.devcli.registry.v1'

/** @typedef {{name:string,script:string,channels:string[],defaultChannel:string,readOnly:boolean,summary:string,usage:string,legacy?:boolean}} Command */

/** @type {Command[]} */
export const COMMANDS = [
  { name: 'act', script: 'act.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '元素动作（element_action 18 动作）', usage: 'act.mjs <@anchor|selector> <action> [--id v] [--v value]' },
  { name: 'inject', script: 'inject.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '注入：page.data / callMethod / hook / wx mock', usage: 'inject.mjs --data|--call|--hook|--mock-wx|--restore' },
  { name: 'eval', script: 'eval.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '页内执行 JS（automation_evaluate）', usage: 'eval.mjs -e <fnSource|expr> | -f <file>' },
  { name: 'state', script: 'state.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: '页面状态投影（route + data）', usage: 'state.mjs [-k k1,k2] [--deep key]' },
  { name: 'geo', script: 'geo.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: '元素几何（boundingClientRect）', usage: 'geo.mjs -s <selector[,selector]> [--all]' },
  { name: 'shot', script: 'shot.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: '截图（viewport_action / simulator_screenshot）', usage: 'shot.mjs [-o path] [--sim]' },
  { name: 'nav', script: 'nav.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '页面导航', usage: 'nav.mjs navigateTo|reLaunch|redirectTo|navigateBack [url]' },
  { name: 'refresh', script: 'refresh.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '模拟器重编译 + 沉降等待', usage: 'refresh.mjs [--wait ms]' },
  { name: 'reset', script: 'reset.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: 'debug_clear_cache 9 类复位', usage: 'reset.mjs [--type storage|file|session|auth|webview|compile|filelist|allsim|all]' },
  { name: 'scene', script: 'scene.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '主题 / sysinfo / 深链场景', usage: 'scene.mjs dark|light|system | --sysinfo ... | --page ... | --read' },
  { name: 'console', script: 'console.mjs', channels: ['mcp', 'skill', 'automator'], defaultChannel: 'mcp', readOnly: true, summary: 'console 快照/实时监听（真机走 automator）', usage: 'console.mjs [--via mcp|skill|auto] [--grep str]' },
  { name: 'network', script: 'network.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: 'network 快照', usage: 'network.mjs [--via mcp|skill] [--grep str]' },
  { name: 'preview', script: 'preview.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: 'auto_preview + 授权任务轮询', usage: 'preview.mjs [--timeout ms]' },
  { name: 'region', script: 'region.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: '区域截图（geo → viewport → jimp 裁切）', usage: 'region.mjs <@anchor|selector> [-o out.png] [--id v]' },
  { name: 'session', script: 'session.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: 'REPL/批处理单桥会话载体', usage: 'session.mjs [--via mcp|skill] [-f steps.txt]' },
  { name: 'device', script: 'device.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: false, summary: '真机 remote 拉起 + 四件套 dump', usage: 'device.mjs --remote [--seconds s] | --dump-only' },
  { name: 'replay', script: 'replay.mjs', channels: ['mcp', 'skill', 'automator'], defaultChannel: 'mcp', readOnly: false, summary: 'generate_script 导出 / 重跑', usage: 'replay.mjs --export <name> | --run <name> [--via ...] | --list' },
  { name: 'visual', script: 'visual.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: true, summary: 'UT-5x 双主题截图套件', usage: 'visual.mjs [--port] [--out dir] [--prefix ut-]' },
  { name: 'lint', script: 'lint.mjs', channels: ['node'], defaultChannel: 'node', readOnly: true, summary: '锚点双向对账（未锚/烂锚/未注册）', usage: 'lint.mjs [--json]' },
  { name: 'tools', script: 'tools.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: 'DevTools 工具目录（tools/list × tools.yaml）', usage: 'tools.mjs [--json] [--full] [--schema <tool>] [--scenes] [--diff] [--refresh] [--via mcp|skill]' },
  { name: 'mcp', script: 'mcp.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: false, summary: '任意工具透传（逃逸舱门）', usage: 'mcp.mjs <tool> \'<json-args>\' [--via mcp|skill] [--json]' },
  { name: 'cli', script: 'cli.mjs', channels: ['cli'], defaultChannel: 'cli', readOnly: false, summary: '官方 CLI v2 透传（含 agent/auto-replay/engine）', usage: 'cli.mjs <cmd> [...] [--json]' },
  { name: 'doctor', script: 'doctor.mjs', channels: ['skill', 'cli', 'mcp'], defaultChannel: 'skill', readOnly: true, summary: 'DevTools/skill/MCP/automator/项目健康检查', usage: 'doctor.mjs [--json] [--offline] [--probe]' },
  { name: 'catalog', script: 'catalog.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: '工具目录 dump/diff/缓存（AI 增强工具面）', usage: 'catalog.mjs [--json] [--full] [--diff] [--refresh] [--tool <name>]' },
  { name: 'testaccount', script: 'testaccount.mjs', channels: ['skill', 'mcp'], defaultChannel: 'skill', readOnly: false, summary: '测试号 / 登录 ticket 管理', usage: 'testaccount.mjs list|getTicket|setTicket|refreshTicket [--ticket t] [--json]' },
  { name: 'task', script: 'task.mjs', channels: ['mcp', 'skill'], defaultChannel: 'mcp', readOnly: true, summary: '异步任务轮询（polling_task_result）', usage: 'task.mjs <taskId> [--timeout ms] [--interval ms] [--json]' },
  { name: 'agent', script: 'agent.mjs', channels: ['agent'], defaultChannel: 'agent', readOnly: false, summary: 'IDE 内置 AI agent（非确定性，探索用）', usage: 'agent.mjs <start|tool|chat|render|card-click|get-dom|get-card-image|clear|debug|overlay|detail-close> [...]' },
  { name: 'skill', script: 'skill.mjs', channels: ['skill'], defaultChannel: 'skill', readOnly: false, summary: 'skill-cli 透传（wechatide -c）', usage: 'skill.mjs <tool> \'<json-args>\' [--json]' },
  { name: 'index', script: 'index.mjs', channels: ['node'], defaultChannel: 'node', readOnly: true, summary: 'dev-cli 统一入口/命令发现', usage: 'index.mjs [--list|--json] <command> [...]' },
  // legacy 专项探针（已收编 ProbeDriver；保留为历史入口）
  { name: 'byok-probe', script: 'byok-probe.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: false, summary: '真机 BYOK 全链取证（legacy）', usage: 'byok-probe.mjs [--port 9602] [--prompt ...]', legacy: true },
  { name: 'sim-toolcall-probe', script: 'sim-toolcall-probe.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: false, summary: '模拟器 tool-call 全链验证（legacy）', usage: 'sim-toolcall-probe.mjs', legacy: true },
  { name: 'md-visual-probe', script: 'md-visual-probe.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: true, summary: 'markdown 渲染视觉验证（legacy）', usage: 'md-visual-probe.mjs', legacy: true },
  { name: 'md-dark', script: 'md-dark.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: true, summary: 'markdown 暗色截图（legacy）', usage: 'md-dark.mjs', legacy: true },
  { name: 'md-shot-scroll', script: 'md-shot-scroll.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: true, summary: '滚屏连拍（legacy）', usage: 'md-shot-scroll.mjs', legacy: true },
  { name: 'unlock-shot', script: 'unlock-shot.mjs', channels: ['automator'], defaultChannel: 'automator', readOnly: true, summary: 'unlock 悬浮/loading 截图（legacy）', usage: 'unlock-shot.mjs', legacy: true },
]

export function listCommands() {
  return COMMANDS
}

export function findCommand(name) {
  return COMMANDS.find((c) => c.name === name)
}

export function registryReport() {
  return {
    schema: REGISTRY_SCHEMA,
    total: COMMANDS.length,
    commands: COMMANDS.map(({ name, script, channels, defaultChannel, readOnly, summary, usage, legacy }) => ({
      name, script, channels, defaultChannel, readOnly, summary, usage, ...(legacy ? { legacy } : {}),
    })),
  }
}

/** 静态对账：注册表 ↔ 顶层脚本；供 doctor 使用。 */
export function assertRegistry({ dir = `${REPO_ROOT}/scripts/dev-cli` } = {}) {
  const missingScripts = COMMANDS.filter((c) => !existsSync(join(dir, c.script))).map((c) => c.script)
  const names = COMMANDS.map((c) => c.name)
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
  const invalid = COMMANDS.filter((c) =>
    !c.name || !c.script || !Array.isArray(c.channels) || c.channels.length === 0
    || !c.defaultChannel || !c.channels.includes(c.defaultChannel)
    || typeof c.readOnly !== 'boolean' || !c.summary || !c.usage)
    .map((c) => c.name)
  const scripts = readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && statSync(join(dir, f)).isFile())
  const registered = new Set(COMMANDS.map((c) => c.script))
  const unregistered = scripts.filter((s) => !registered.has(s))
  return {
    ok: missingScripts.length === 0 && duplicates.length === 0 && invalid.length === 0 && unregistered.length === 0,
    missingScripts, duplicates, invalid, unregistered,
    total: COMMANDS.length,
  }
}
