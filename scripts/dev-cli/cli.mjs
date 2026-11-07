// dev-cli · 官方 CLI v2 透传（含 2.02.2609250 新增的 agent / auto-replay / engine）。
//
// 官方命令面（https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.md）：
//   login islogin preview upload auto-preview auto auto-replay build-npm open close quit
//   reset-fileutils cache cloud.* engine build
//   agent start|tool|chat|render|card-click|get-dom|get-card-image|clear|debug|overlay|detail-close
//
// 用法:
//   node scripts/dev-cli/cli.mjs islogin
//   node scripts/dev-cli/cli.mjs upload -v 1.0.0 -d 'desc'     （--project 自动注入）
//   node scripts/dev-cli/cli.mjs auto --auto-port 9602
//   node scripts/dev-cli/cli.mjs auto-replay --replay-all --replay-config-path ./replay.json
//   node scripts/dev-cli/cli.mjs agent chat --query '检查首页'
//   node scripts/dev-cli/cli.mjs cloud functions list --env xx
//   node scripts/dev-cli/cli.mjs --raw islogin                  （不注入 --project）
//   node scripts/dev-cli/cli.mjs --json islogin                 （capture stdout/stderr/exit）
import { cliRun, CLI_PATH } from './lib/ide.mjs'
import { runMain } from './lib/report.mjs'

const raw = process.argv.slice(2)
const json = raw.includes('--json')
const noProject = raw[0] === '--raw'
const args = raw.filter((a) => a !== '--json' && a !== '--raw')

if (args.length === 0) {
  console.error(`用法: cli.mjs <cmd> [...] [--json] [--raw]\nCLI_PATH=${CLI_PATH}`)
  process.exit(2)
}

if (json) {
  await runMain('cli', async () => {
    const r = await cliRun(args, { capture: true, injectProject: !noProject })
    if (!r.ok) throw new Error(`cli ${args[0]} exit=${r.code}${r.timedOut ? ' (timeout)' : ''}\n${r.stderr.slice(-800)}`)
    return { cmd: args[0], code: r.code, stdout: r.stdout, stderr: r.stderr }
  }, { json: true })
} else {
  const r = await cliRun(args, { capture: false, injectProject: !noProject })
  process.exit(r.code ?? 0)
}
