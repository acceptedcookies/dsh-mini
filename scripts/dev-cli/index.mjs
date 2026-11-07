// dev-cli · 统一入口 / 命令发现（AI agent 的单一入口）。
//
// 用法:
//   node scripts/dev-cli/index.mjs --list            列出全部命令（人读）
//   node scripts/dev-cli/index.mjs --json            注册表 JSON（机器读）
//   node scripts/dev-cli/index.mjs <command> [...]   透传到对应脚本
//   例: index.mjs doctor --json
//       index.mjs tools --full
//       index.mjs testaccount getTicket --json
//
// 说明: 本文件只做进程分发（spawn），不建 MCP/automator 桥；
//       no-self-bridge 静态闸把它列为 dispatcher 豁免。
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS, findCommand, registryReport } from './lib/registry.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const raw = process.argv.slice(2)

function printList() {
  console.log('dev-cli commands:')
  for (const c of COMMANDS) {
    const rw = c.readOnly ? 'R' : 'W'
    const legacy = c.legacy ? ' [legacy]' : ''
    console.log(`  ${rw} ${c.name.padEnd(20)} ${c.channels.join('/')}  ${c.summary}${legacy}`)
  }
  console.log('\n用法: index.mjs <command> [...]  ·  --json 机器读  ·  --list 本表')
}

if (raw.includes('--list') || raw.length === 0) {
  printList()
  process.exit(0)
}
if (raw[0] === '--json') {
  console.log(JSON.stringify(registryReport(), null, 2))
  process.exit(0)
}

const cmdIndex = raw.findIndex((a) => findCommand(a) !== undefined)
if (cmdIndex === -1) {
  console.error(`未知命令 '${raw[0]}'——index.mjs --list 查看全部`)
  process.exit(2)
}
const cmd = findCommand(raw[cmdIndex])
const rest = raw.slice(cmdIndex + 1)
const script = resolve(DIR, cmd.script)
const child = spawn(process.execPath, [script, ...rest], { stdio: 'inherit' })
child.on('error', (e) => { console.error(`启动 ${cmd.script} 失败: ${e.message}`); process.exit(1) })
child.on('exit', (code) => process.exit(code ?? 1))
