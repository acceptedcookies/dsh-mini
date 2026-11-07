// L1（Node）：dev-cli 工具注册表 ↔ 顶层脚本双向对账——不开 IDE。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { COMMANDS, assertRegistry, registryReport, findCommand } = await import(`${ROOT}/scripts/dev-cli/lib/registry.mjs`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const reg = assertRegistry()
check('注册表 ↔ 顶层脚本对账', reg.ok, JSON.stringify({ missing: reg.missingScripts, unregistered: reg.unregistered, dup: reg.duplicates, invalid: reg.invalid }))
check('命令量 ≥ 30', COMMANDS.length >= 30, `n=${COMMANDS.length}`)

const bad = COMMANDS.filter((c) =>
  !c.name || !c.script || !Array.isArray(c.channels) || c.channels.length === 0
  || !c.defaultChannel || !c.channels.includes(c.defaultChannel)
  || typeof c.readOnly !== 'boolean' || !c.summary || !c.usage)
check('每条 {name,script,channels,defaultChannel,readOnly,summary,usage} 完整', bad.length === 0, bad.map((c) => c.name).join(','))

const names = COMMANDS.map((c) => c.name)
check('命令名唯一', new Set(names).size === names.length)
check('新 AI 增强工具已登记', ['doctor', 'catalog', 'testaccount', 'task', 'agent', 'skill', 'index'].every((n) => findCommand(n) !== undefined))
check('registryReport schema', registryReport().schema === 'dsh-mini.devcli.registry.v1' && registryReport().total === COMMANDS.length)

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
