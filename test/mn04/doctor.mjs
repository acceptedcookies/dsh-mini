// L1（Node，offline）：doctor 结构/检查面/汇总——不触 IDE。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { doctor, DOCTOR_SCHEMA } = await import(`${ROOT}/scripts/dev-cli/lib/doctor.mjs`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const r = await doctor({ offline: true })
const ids = new Set((r.checks ?? []).map((c) => c.id))
check('doctor schema', r.schema === DOCTOR_SCHEMA && r.reportSchema === 'dsh-mini.devcli.v1')
check('检查面齐全', ['devtools.app', 'devtools.cli', 'devtools.wechatide', 'devtools.skill', 'devtools.mcp.token', 'registry', 'catalog.skill', 'project.appid'].every((id) => ids.has(id)), [...ids].join(','))
check('summary 与 checks 一致', r.summary.total === r.checks.length && r.summary.pass + r.summary.warn + r.summary.error + r.summary.info === r.summary.total)
check('offline 不触 automator', r.channels?.automator?.skipped === true)
check('每条 check 有 level/detail', r.checks.every((c) => typeof c.ok === 'boolean' && ['error', 'warn', 'info'].includes(c.level) && typeof c.detail === 'string'))

const pass = results.filter((x) => x.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
