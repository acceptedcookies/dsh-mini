// L1（Node）：桥收编静态闸——scripts/dev-cli/*.mjs 顶层工具不得自建桥。
// 白名单：lib/、cli.mjs、console.mjs --via auto 段（automator 语义豁免登记）。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = `${ROOT}/scripts/dev-cli`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const BRIDGE_RE = /McpClient\.open|connectIde\s*\(|automator\.(connect|launch)|launchAndConnect/
const EXEMPT = new Set(['cli.mjs'])                      // 生命周期 CLI 道本务
const EXEMPT_PARTIAL = new Set(['console.mjs'])           // --via auto 段豁免（行级判定）

const offenders = []
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.mjs'))) {
  if (EXEMPT.has(f)) continue
  const src = readFileSync(`${DIR}/${f}`, 'utf8')
  const hits = src.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => BRIDGE_RE.test(l) && !/^\s*(\*|\/\/)/.test(l))
  if (!hits.length) continue
  if (EXEMPT_PARTIAL.has(f)) {
    // 只允许 connectIde 出现在 --via auto 分支语义里（import + via==='auto' 同文件）
    const illegal = hits.filter(({ l }) => !/connectIde|pipeConsole/.test(l))
    if (illegal.length) offenders.push(`${f}: ${illegal.map((h) => `${h.i}:${h.l.trim().slice(0, 60)}`).join(' | ')}`)
    continue
  }
  offenders.push(`${f}: ${hits.map((h) => `${h.i}:${h.l.trim().slice(0, 60)}`).join(' | ')}`)
}
check('顶层工具零自建桥（除 cli.mjs / console --via auto）', offenders.length === 0, offenders.join(' ;; '))

// 反向闸：lib/ide.mjs 与 lib/mcp.mjs 的桥构造在 lib 内部（收编位置存在）
const mcp = readFileSync(`${DIR}/lib/mcp.mjs`, 'utf8')
const ide = readFileSync(`${DIR}/lib/ide.mjs`, 'utf8')
check('桥构造集中在 lib（mcp.open + ide.connectIde）', /class McpClient/.test(mcp) && /export async function connectIde/.test(ide))
check('bridgeCount 计数存在', /bridgeCount/.test(mcp))

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
