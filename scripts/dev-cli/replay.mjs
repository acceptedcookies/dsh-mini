// dev-cli · replay：generate_script 录制导出 → test/replay/*.mjs 重跑（T-O-5）。
// 用法:
//   node scripts/dev-cli/replay.mjs --export <name>     从 MCP 录制史导出 automator 脚本
//   node scripts/dev-cli/replay.mjs --run <name>        在 automator 通道重跑该脚本
//   node scripts/dev-cli/replay.mjs --list             列已登记脚本
//
// 语义：录制在模拟器 MCP 面、回放可在模拟器或真机 remote ws（--via auto）。
// 导出脚本头部注记差异坑位；commit 前人工审 sessionId/凭证残值。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const DIR = resolve('test/replay')
mkdirSync(DIR, { recursive: true })

if (flags.list === true) {
  console.log(readdirSync(DIR).filter((f) => f.endsWith('.mjs')).join('\n') || '(none)')
  process.exit(0)
}

const name = flagOf(flags, 'export', flagOf(flags, 'run', null))
if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
  console.error('用法: replay.mjs --export <name> | --run <name> | --list')
  process.exit(2)
}
const file = `${DIR}/${name}.mjs`

if (flags.export !== undefined) {
  // 导出走 MCP 桥（generate_script 吃 MCP 调用史——所以录制前要在同桥里做动作）
  const d = await ProbeDriver.open()
  try {
    const r = await d.call('automation_generate_script', { includeFailed: false })
    const code = r?.result?.script ?? r?.script ?? r?.result ?? r
    if (typeof code !== 'string' || !code.trim()) throw new Error(`generate_script 无脚本产物: ${JSON.stringify(r).slice(0, 200)}`)
    const header = `// replay 导出（MN04）：模拟器 MCP 面录制；真机回放需 --via auto 的 remote ws 会话。
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
  // 重跑：脚本模块导出 run(mp) 或裸 automator 语句序列
  const d = await ProbeDriver.open({ via: flagOf(flags, 'via', 'automator') })
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
