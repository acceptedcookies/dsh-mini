// dev-cli · pitfalls 机器匹配（T-O-6）：pitfalls.json 为唯一真源。
// matchPitfall(err.message, where) → 命中条目；wrapError 产出带 [PITFALL-n]
// 解法或「请业主：{ownerAction}」前缀的 Error。symptom/where 均为正则。
import { readFileSync, writeFileSync } from 'node:fs'
import { REPO_ROOT } from './args.mjs'

export const PITFALLS_PATH = `${REPO_ROOT}/scripts/dev-cli/pitfalls.json`

let _cache = null
export function loadPitfalls(path = PITFALLS_PATH) {
  if (_cache === null || path !== PITFALLS_PATH) {
    const reg = JSON.parse(readFileSync(path, 'utf8'))
    _cache = path === PITFALLS_PATH ? (reg.pitfalls ?? []) : (reg.pitfalls ?? [])
    if (path !== PITFALLS_PATH) return reg.pitfalls ?? []
  }
  return _cache
}

/** 命中返回条目；未命中返回 undefined。where=调用语境（工具名/通道标签）。 */
export function matchPitfall(message, where = '', list = loadPitfalls()) {
  const msg = String(message ?? '')
  for (const p of list) {
    let hit = false
    try { hit = new RegExp(p.symptom, 'i').test(msg) } catch { hit = msg.includes(p.symptom) }
    if (!hit) continue
    if (p.where && !new RegExp(p.where, 'i').test(where)) continue
    return p
  }
  return undefined
}

/** degraded 当轮登记新坑（P4-02）：追加到 pitfalls.json 真源并失效缓存。
 *  同 symptom+where 已存在则复用（防重复登记/ID 膨胀）。 */
export function appendPitfall({ symptom, where, cause, fix, ownerAction }) {
  const reg = JSON.parse(readFileSync(PITFALLS_PATH, 'utf8'))
  const list = reg.pitfalls ?? []
  const dup = list.find((p) => p.symptom === symptom && (p.where ?? '') === (where ?? ''))
  if (dup !== undefined) return dup
  const id = `PITFALL-${Math.max(0, ...list.map((p) => Number(String(p.id).replace(/\D/g, '')))) + 1}`
  const entry = { id, symptom, where, cause, ...(fix !== undefined ? { fix } : {}), ...(ownerAction !== undefined ? { ownerAction } : {}), since: new Date().toISOString().slice(0, 10) }
  list.push(entry)
  reg.pitfalls = list
  writeFileSync(PITFALLS_PATH, JSON.stringify(reg, null, 2) + '\n')
  _cache = null
  return entry
}

export function pitfallById(id, list = loadPitfalls()) {
  return list.find((p) => p.id === id)
}

/** 错误分类（AI 增强形态）：pitfall 优先，其次按语义分 kind。
 *  kind ∈ approval|token|version|project|device|timeout|skill|agent|unknown。 */
export function classifyError(err, where = '') {
  const e = err instanceof Error ? err : new Error(String(err))
  const msg = e.message
  const p = matchPitfall(msg, where)
  if (p !== undefined) return { kind: p.id, pitfall: p }
  if (/MCP Token is missing|mcp_token_required/i.test(msg)) return { kind: 'token' }
  if (/versionRelation|agent_behind|agent_ahead|skill.*version/i.test(msg)) return { kind: 'version' }
  if (/-32603|Bad Request/i.test(msg)) return { kind: 'approval' }
  if (/PROJECT_PATH_NOT_FOUND|PROJECT_CONFIG_JSON_ERROR|APPID_ERROR/i.test(msg)) return { kind: 'project' }
  if (/Device disconnected|remote-debug|device-absent|enableRemoteDebug/i.test(msg)) return { kind: 'device' }
  if (/timeout|timed out/i.test(msg)) return { kind: 'timeout' }
  if (/skill-call|wechatide-skill/i.test(msg)) return { kind: 'skill' }
  if (/agent (server|start)|cli agent/i.test(msg)) return { kind: 'agent' }
  return { kind: 'unknown' }
}

/** 包错误：命中 → `[PITFALL-n] {fix}` 或 `请业主：{ownerAction}` 前缀 Error；未命中原样。
 *  无论命中与否都附加 kind（classifyError），供 report.mjs 机器消费。 */
export function wrapError(err, where = '') {
  const e = err instanceof Error ? err : new Error(String(err))
  const c = classifyError(e, where)
  const p = c.pitfall
  if (!p) {
    e.kind = c.kind
    return e
  }
  const advice = p.ownerAction ? `请业主：${p.ownerAction}` : p.fix
  const wrapped = new Error(`[${p.id}] ${e.message} — ${advice}`)
  wrapped.cause = e
  wrapped.pitfall = p
  wrapped.kind = c.kind
  return wrapped
}
