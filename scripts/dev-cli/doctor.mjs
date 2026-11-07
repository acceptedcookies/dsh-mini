// dev-cli · 健康检查（AI 增强形态的 doctor）。
// 用法:
//   node scripts/dev-cli/doctor.mjs              文件面 + 在线 skill 状态 + automator 端口
//   node scripts/dev-cli/doctor.mjs --offline    只查文件面（不触 IDE）
//   node scripts/dev-cli/doctor.mjs --probe      追加 MCP 握手 + tools/list 对账
//   node scripts/dev-cli/doctor.mjs --json       机器可读
// 出口: 0=无 error 级失败；1=有 error 级失败（warn 不失败）。
import { parseArgs, boolFlag, numberFlag } from './lib/args.mjs'
import { doctor } from './lib/doctor.mjs'
import { makeReport, emit, exitCodeFor, errorInfo } from './lib/report.mjs'

const { flags } = parseArgs()
const json = boolFlag(flags, 'json')
const offline = boolFlag(flags, 'offline')
const probe = boolFlag(flags, 'probe')
const automatorPort = numberFlag(flags, 'automator-port', undefined)

try {
  const data = await doctor({ offline, probe, automatorPort })
  const warnings = data.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => `${c.id}: ${c.detail}`)
  const report = makeReport({ command: 'doctor', ok: data.ok, data, warnings })
  emit(report, { json })
  process.exitCode = exitCodeFor(report)
  setTimeout(() => process.exit(process.exitCode), 100).unref()
} catch (e) {
  const report = makeReport({ command: 'doctor', ok: false, error: errorInfo(e) })
  emit(report, { json })
  process.exitCode = 1
  setTimeout(() => process.exit(1), 100).unref()
}
