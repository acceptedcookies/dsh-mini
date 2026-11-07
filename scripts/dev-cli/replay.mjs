// dev-cli · replay：generate_script 录制导出 → .anote/replay/*.mjs 重跑（T-O-5）。
// 用法:
//   node scripts/dev-cli/replay.mjs --export <name>     从 MCP/skill 录制史导出 automator 脚本
//   node scripts/dev-cli/replay.mjs --run <name>        在 automator 通道重跑该脚本
//   node scripts/dev-cli/replay.mjs --list             列已登记脚本
//   node scripts/dev-cli/replay.mjs --auto-replay [--config <path>]  官方 cli auto-replay 透传
//
// 语义：录制在模拟器 MCP/skill 面、回放需要 automator（--run 恒拉 automator；
//       --via 只影响导出通道）。导出脚本头部注记差异坑位；commit 前人工审 sessionId/凭证残值。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProbeDriver } from './lib/probe.mjs'
import { CliChannel } from './lib/channels.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const DIR = resolve('.anote/replay')
mkdirSync(DIR, { recursive: true })

if (flags.list === true) {
  console.log(readdirSync(DIR).filter((f) => f.endsWith('.mjs')).join('\n') || '(none)')
  process.exit(0)
}

if (flags['auto-replay'] === true) {
  const cfg = flagOf(flags, 'config', undefined)
  const ch = CliChannel.open()
  const args = ['auto-replay', '--replay-all', ...(cfg !== undefined ? ['--replay-config-path', cfg] : [])]
  const r = await ch.run(args, { capture: true, timeoutMs: 600000 })
  console.log(JSON.stringify({ mode: 'auto-replay', config: cfg ?? null, ...r }, null, 2))
  process.exit(r.ok ? 0 : 1)
}

const name = flagOf(flags, 'export', flagOf(flags, 'run', null))
if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
  console.error('用法: replay.mjs --export <name> | --run <name> | --list')
  process.exit(2)
}
const file = `${DIR}/${name}.mjs`

if (flags.export !== undefined) {
  // 导出走 MCP/skill 通道（generate_script 吃该通道的调用史——录制前要在同通道里做动作）
  const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
  try {
    const r = await d.call('automation_generate_script', { includeFailed: false })
    const pick = (v) => {
      if (typeof v === 'string') return v
      if (v === null || typeof v !== 'object') return undefined
      if (typeof v.script === 'string') return v.script
      if (typeof v.text === 'string') return v.text
      if (Array.isArray(v.content) && typeof v.content[0]?.text === 'string') return v.content[0].text
      if (typeof v.structuredContent === 'string') return v.structuredContent
      if (v.structuredContent !== null && typeof v.structuredContent === 'object' && typeof v.structuredContent.script === 'string') return v.structuredContent.script
      return undefined
    }
    const code = pick(r?.result) ?? pick(r?.structuredContent) ?? pick(r)
    if (typeof code !== 'string' || !code.trim()) throw new Error(`generate_script 无脚本产物: ${JSON.stringify(r).slice(0, 200)}`)
    const header = `// replay 导出：模拟器 MCP 面录制；真机回放需 --via auto 的 remote ws 会话。
// 差异坑位：模拟器 selector/时序与真机渲染节奏不同——waitForSelector 超时要放宽。
// ⚠ commit 前人工审：sessionId/prompt 文本/凭证残值不得入库。
`
    writeFileSync(file, header + code)
    console.log(JSON.stringify({ exported: file, bytes: header.length + code.length }, null, 2))
  } finally {
    await d.close()
  }
} else {
  if (!existsSync(file)) {
    console.error(`脚本不存在: ${file}——先 --export ${name}`)
    process.exit(2)
  }
  // 重跑：脚本需要 automator mp；终态 route 回读优先 MCP，automator-only 时走 mp.evaluate。
  const via = flagOf(flags, 'via', undefined)
  const d = via === 'automator'
    ? await ProbeDriver.open({ via: 'automator' })
    : await ProbeDriver.open({ via: via === 'skill' ? 'mcp' : (via ?? 'mcp'), needAutomator: true })
  try {
    const mod = await import(pathToFileURL(file).href)
    const before = await d.route().catch(() => null)
    if (typeof mod.default === 'function') {
      await mod.default(d.mp)
    } else {
      throw new Error('导出脚本无 default 函数——generate_script 产物需包装为 export default async (mp) => {...}')
    }
    // 终态断言（计划硬闸：不只 exit code）
    const after = await d.route().catch(() => null)
    const ok = after !== null
    console.log(JSON.stringify({ ran: name, before, after, terminalReadback: ok ? 'route-ok' : 'route-fail' }, null, 2))
    if (!ok) process.exit(4)
  } finally {
    await d.close()
  }
}
