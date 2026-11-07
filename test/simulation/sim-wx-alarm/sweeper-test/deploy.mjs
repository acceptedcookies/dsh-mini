// sim-wx-alarm · sweeper-test 部署器（Live-B 专用；不打印 secret）。
// 用法:
//   node test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs [--no-trigger] [--keep]
// 依赖: 本机 tcb CLI 已登录；cloud/functions/sweeper/vendor + node_modules 已存在。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..')
const ENV_FILE = path.join(REPO, '.anote/frd1/gateway.env')
const VENDOR = path.join(REPO, 'cloud/functions/sweeper/vendor')
const NODE_MODULES = path.join(REPO, 'cloud/functions/sweeper/node_modules')
const APPID = 'wx356d3abb52825466'
const ENV_ID = 'cloud1-d7gar8j7w419589a0'

const args = process.argv.slice(2)
const noTrigger = args.includes('--no-trigger')
const keep = args.includes('--keep')

function loadSecret() {
  const env = {}
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  if (!env.TICKET_SECRET) throw new Error('TICKET_SECRET missing in .anote/frd1/gateway.env')
  return env.TICKET_SECRET
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', cwd: REPO, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} exit=${r.status}`)
}

const secret = loadSecret()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-wx-alarm-sweeper-'))
const fnDir = path.join(root, 'sweeper-test')
const projectDir = path.join(root, 'project')
fs.mkdirSync(fnDir, { recursive: true })
fs.mkdirSync(projectDir, { recursive: true })

try {
  fs.copyFileSync(path.join(HERE, 'index.js'), path.join(fnDir, 'index.js'))
  fs.copyFileSync(path.join(HERE, 'package.json'), path.join(fnDir, 'package.json'))
  fs.cpSync(VENDOR, path.join(fnDir, 'vendor'), { recursive: true })
  if (!fs.existsSync(NODE_MODULES)) throw new Error(`缺 ${NODE_MODULES}；先在 cloud/functions/sweeper 安装依赖`)
  fs.cpSync(NODE_MODULES, path.join(fnDir, 'node_modules'), { recursive: true })

  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'cloudbaserc.template.json'), 'utf8'))
  cfg.envId = ENV_ID
  cfg.functionRoot = '..'
  cfg.functions[0].envVariables.TICKET_SECRET = secret
  fs.writeFileSync(path.join(projectDir, 'cloudbaserc.json'), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })

  run('tcb', ['fn', 'deploy', 'sweeper-test', '--cwd', projectDir, '--runtime', 'Nodejs20.19', '--install-dependency', 'false', '--force'])
  if (!noTrigger) run('tcb', ['fn', 'trigger', 'create', 'sweeper-test', '--trigger-name', 'tick', '--cron', '0/30 * * * * * *', '-e', ENV_ID])
  console.log(JSON.stringify({ ok: true, function: 'sweeper-test', runtime: 'Nodejs20.19', timeout: 60, trigger: noTrigger ? null : 'tick 0/30', appid: APPID, envId: ENV_ID }, null, 2))
} finally {
  if (keep) console.log(`[deploy-sweeper-test] kept ${root}`)
  else fs.rmSync(root, { recursive: true, force: true })
}
