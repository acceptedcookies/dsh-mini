// 静态闸：scripts/dev-cli 顶层工具不许自建桥——所有桥构造必须经 lib/probe.mjs。
// 逃逸道全封：直接构造器/库 import 字面/动态 import/裸 ws/spawn/子目录。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = `${ROOT}/scripts/dev-cli`
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const BRIDGE_RE = /McpClient\.open|\bnew\s+McpClient\b|connectIde\s*\(|automator\.(connect|launch)|launchAndConnect|miniprogram-automator|new\s+WebSocket\s*\(|spawn\s*\(|createRequire|import\s*\(\s*['"]miniprogram-automator/
const EXEMPT = new Set(['cli.mjs'])                      // 生命周期 CLI 道本务（spawn 直通无桥语义）
const EXEMPT_PARTIAL = new Set(['console.mjs'])           // --via auto 段豁免（仅允许 connectIde/pipeConsole 词位）

const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (f !== 'lib') walk(p, out); continue }
    if (/\.(mjs|cjs|js)$/.test(f)) out.push(p)
  }
  return out
}

const offenders = []
for (const f of walk(DIR)) {
  const base = f.split('/').pop()
  if (EXEMPT.has(base)) continue
  const src = readFileSync(f, 'utf8')
  const hits = src.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => BRIDGE_RE.test(l) && !/^\s*(\*|\/\/)/.test(l) && !/^\s*import\s*\{[^}]*\}\s*from\s*['"]\.\/lib\//.test(l))
  if (!hits.length) continue
  if (EXEMPT_PARTIAL.has(base)) {
    // --via auto 豁免只允许 connectIde/pipeConsole/ProbeDriver 词位
    const illegal = hits.filter(({ l }) => !/connectIde|pipeConsole|ProbeDriver/.test(l))
    if (illegal.length) offenders.push(`${base}: ${illegal.map((h) => `${h.i}:${h.l.trim().slice(0, 60)}`).join(' | ')}`)
    continue
  }
  offenders.push(`${base}: ${hits.map((h) => `${h.i}:${h.l.trim().slice(0, 60)}`).join(' | ')}`)
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
