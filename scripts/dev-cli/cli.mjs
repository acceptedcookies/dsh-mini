// dev-cli · 官方 CLI v2 透传：cli.bat / Contents/MacOS/cli 薄封装。
// 自动注入 --project <repo> --lang zh；直通官方命令面（AGENTS.md 引用的
// https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.md）：
//   login islogin preview upload auto-preview auto build-npm open close quit
//   reset-fileutils cache cloud.*
// 用法:
//   node scripts/dev-cli/cli.mjs islogin
//   node scripts/dev-cli/cli.mjs upload -v 1.0.0 -d 'desc'     （--project 自动注入）
//   node scripts/dev-cli/cli.mjs cache --type storage
//   node scripts/dev-cli/cli.mjs auto --auto-port 9602          （拉起自动化）
//   node scripts/dev-cli/cli.mjs cloud functions list --env xx
//   node scripts/dev-cli/cli.mjs --raw islogin                  （不注入 --project）
import { spawn } from 'node:child_process'
import { CLI_PATH } from './lib/ide.mjs'
import { PROJECT } from './lib/args.mjs'

const args = process.argv.slice(2)
const raw = args[0] === '--raw'
if (raw) args.shift()

// 登录态/退出类命令不吃 --project；其余注入
const noProject = new Set(['login', 'islogin', 'quit', 'reset-fileutils', '-h', '--help', '-v', '--version'])
const cmd = args[0] ?? '-h'
const needsProject = !raw && !noProject.has(cmd)
const final = needsProject ? [...args, '--project', PROJECT] : args

const p = spawn(CLI_PATH, final, { stdio: 'inherit' })
p.on('exit', (code) => process.exit(code ?? 0))
p.on('error', (e) => { console.error(`cli 启动失败: ${e.message}\nCLI_PATH=${CLI_PATH}`); process.exit(1) })
