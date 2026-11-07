// dev-cli · CloudBase tcb 高级通道（调试 / 测试 / 应用脚本）。
//
// 真源：https://cloudbase.net/skill.md
// 用法:
//   node scripts/dev-cli/tcb.mjs status [--json]
//   node scripts/dev-cli/tcb.mjs doctor [--json] [--env <envId>] [--function <name>]
//   node scripts/dev-cli/tcb.mjs env list|use <envId> [--json]
//   node scripts/dev-cli/tcb.mjs fn list|detail|deploy|invoke|trigger-create|trigger-delete|logs|env-pull ...
//   node scripts/dev-cli/tcb.mjs db|hosting|storage|cloudrun|logs|docs|api|secrets|config|app|... ...
//   node scripts/dev-cli/tcb.mjs live-b
//   node scripts/dev-cli/tcb.mjs deploy-sweeper-test
//   node scripts/dev-cli/tcb.mjs raw <args...>
//
// 约束: 不调用顶层 `tcb deploy`；fn detail 的 env/code 默认脱敏；secret 不落仓库。
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, boolFlag, flagOf } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'
import {
  tcbStatus, tcbDoctor, tcbEnvList, tcbFnList, tcbFnDetail, tcbFnDeploy, tcbFnInvoke,
  tcbTriggerCreate, tcbTriggerDelete, tcbDomain, tcbRun,
} from './lib/tcb.mjs'
import { TCB_DOMAINS, TCB_FN_SUBCOMMANDS, tcbDomain as findDomain } from './tcb/commands.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const REPO = join(DIR, '..', '..')
const raw = process.argv.slice(2)
const json = raw.includes('--json')
const args = raw.filter((a) => a !== '--json')
const { flags, positional } = parseArgs(args)
const envId = flagOf(flags, 'env', flagOf(flags, 'e', undefined))
const sub = positional[0]
const rest = positional.slice(1)

function usage() {
  const lines = [
    'tcb — CloudBase 高级通道（skill: https://cloudbase.net/skill.md）',
    '',
    '高级命令:',
    '  status [--json]                     tcb 版本 + 环境列表',
    '  doctor [--json] [--env id] [--function name]',
    '  env list|use <envId>',
    '  fn list|detail|deploy|invoke|trigger-create|trigger-delete|logs|env-pull ...',
    '  live-b                              运行 sim-wx-alarm Live-B',
    '  deploy-sweeper-test                 部署 sim-wx-alarm 的 sweeper-test',
    '  raw <args...>                       透传（禁止 deploy）',
    '',
    '域命令:',
    ...TCB_DOMAINS.map((d) => `  ${d.name.padEnd(16)} ${d.summary}`),
    '',
    'fn 子命令:',
    ...TCB_FN_SUBCOMMANDS.map((s) => `  ${s.name.padEnd(16)} ${s.summary}`),
  ]
  console.log(lines.join('\n'))
}

async function dispatch() {
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    usage()
    return { help: true }
  }

  if (sub === 'status') return tcbStatus()
  if (sub === 'doctor') return tcbDoctor({ envId, functionName: flagOf(flags, 'function', undefined) })
  if (sub === 'env') {
    if (rest[0] === undefined || rest[0] === 'list') return { envs: tcbEnvList(envId) }
    if (rest[0] === 'use' && rest[1] !== undefined) {
      const r = tcbRun(['env', 'use', rest[1]])
      if (r.code !== 0) throw new Error(`tcb env use ${rest[1]} exit=${r.code}\n${r.stderr.slice(-600)}`)
      return { used: rest[1], code: r.code, stdout: r.stdout.trim() }
    }
    throw new Error(`env 只支持 list|use <envId>，收到 ${rest.join(' ')}`)
  }

  if (sub === 'fn') {
    const fnSub = rest[0]
    const name = rest[1]
    if (fnSub === 'list') return { functions: tcbFnList(envId) }
    if (fnSub === 'detail' && name !== undefined) return tcbFnDetail(name, envId)
    if (fnSub === 'deploy' && name !== undefined) {
      return tcbFnDeploy({
        name,
        cwd: flagOf(flags, 'cwd', REPO),
        runtime: flagOf(flags, 'runtime', undefined),
        force: boolFlag(flags, 'force', true),
        installDependency: boolFlag(flags, 'install-dependency', false),
      })
    }
    if (fnSub === 'invoke' && name !== undefined) {
      let data
      const d = flagOf(flags, 'data', flagOf(flags, 'params', undefined))
      if (d !== undefined) { try { data = JSON.parse(String(d)) } catch { throw new Error('--data 不是合法 JSON') } }
      return tcbFnInvoke(name, data, envId)
    }
    if (fnSub === 'trigger-create' && name !== undefined) {
      return tcbTriggerCreate(name, {
        triggerName: flagOf(flags, 'trigger-name', 'tick'),
        cron: flagOf(flags, 'cron', '0/30 * * * * * *'),
        envId,
      })
    }
    if (fnSub === 'trigger-delete' && name !== undefined) {
      return tcbTriggerDelete(name, { triggerName: flagOf(flags, 'trigger-name', 'tick'), envId })
    }
    if (fnSub === 'logs' && name !== undefined) {
      const r = tcbRun(['logs', 'search', name, ...rest.slice(2)], { timeoutMs: 120_000 })
      if (r.code !== 0) throw new Error(`tcb logs search ${name} exit=${r.code}\n${r.stderr.slice(-600)}`)
      return { name, code: r.code, stdout: r.stdout.trim() }
    }
    if (fnSub === 'env-pull' && name !== undefined) {
      const r = tcbRun(['fn', 'env', 'pull', name, ...rest.slice(2)], { timeoutMs: 60_000 })
      if (r.code !== 0) throw new Error(`tcb fn env pull ${name} exit=${r.code}\n${r.stderr.slice(-600)}`)
      return { name, code: r.code, stdout: r.stdout.trim() }
    }
    throw new Error(`fn 子命令不支持: ${rest.join(' ') || '(empty)'}`)
  }

  if (sub === 'live-b') {
    const r = spawnSync(process.execPath, [join(REPO, 'test/simulation/sim-wx-alarm/live-b.mjs')], { stdio: 'inherit' })
    return { liveB: true, code: r.status ?? 1 }
  }
  if (sub === 'deploy-sweeper-test') {
    const r = spawnSync(process.execPath, [join(REPO, 'test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs')], { stdio: 'inherit' })
    return { deploySweeperTest: true, code: r.status ?? 1 }
  }
  if (sub === 'raw') {
    if (rest[0] === 'deploy') throw new Error('tcb deploy 被禁用：请用 fn deploy / hosting deploy 等领域命令')
    const r = tcbRun(rest, { timeoutMs: 180_000 })
    if (r.code !== 0) throw new Error(`tcb ${rest.join(' ')} exit=${r.code}\n${r.stderr.slice(-800)}`)
    return { code: r.code, stdout: r.stdout.trim() }
  }

  const domain = findDomain(sub)
  if (domain !== undefined) {
    const r = tcbDomain(sub, rest, { envId })
    if (r.code !== 0) throw new Error(`tcb ${sub} exit=${r.code}\n${r.stderr.slice(-800)}`)
    return { domain: sub, code: r.code, stdout: r.stdout.trim() }
  }
  throw new Error(`未知 tcb 命令 '${sub}'——tcb.mjs help 查看命令面`)
}

await runMain('tcb', dispatch, { json })
