// MN06-T13 —— env/report 契约：600、缺 key exit 3、报告 schema 含 shadow。
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV_PATH, envFileMode, report } from './env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}

const mode = envFileMode()
check('env:600', mode === 0o600, `mode=${mode === null ? 'missing' : mode.toString(8)}`)

const good = spawnSync(process.execPath, [join(ROOT, 'test/mn06/env.mjs')], { encoding: 'utf8' })
check('env:完整 key exit 0', good.status === 0, `exit=${good.status}`)

const bad = spawnSync(process.execPath, [join(ROOT, 'test/mn06/env.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, TICKET_SECRET: '' },
})
check('env:缺 TICKET_SECRET exit 3', bad.status === 3, `exit=${bad.status}`)

const sample = report('mn06-selftest', [{ id: 'x', pass: true, app: true, shadow: true, god: true }])
const c = sample.cases[0]
check('report:suite+cases 四字段', sample.suite === 'mn06-selftest' && c.app === true && c.shadow === true && c.god === true && c.pass === true)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()} env=${ENV_PATH.replace(ROOT + '/', '')}`)
if (failed.length > 0) process.exit(1)
