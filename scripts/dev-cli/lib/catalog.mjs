/** dev-cli · DevTools 工具目录（capability catalog）：MCP tools/list × skill tools.yaml。
 *
 *  升级后的 DevTools 把「工具面」同时暴露在两条通道：
 *    - MCP tools/list：JSON Schema + 详细 description（运行时权威）
 *    - wechatide-skill/wechatide-tools/references/tools.yaml：scenes + 精简 summary
 *  本模块把两者归一成同一 shape，供 tools/catalog/doctor/ProbeDriver 消费。
 *
 *  归一 shape：
 *    { name, group, scenes[], summary, description, inputSchema, skillSchema,
 *      transport, readOnly, deprecated, sources[] }
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { REPO_ROOT } from './args.mjs'
import { readSkillTools } from './devtools.mjs'

export const CATALOG_SCHEMA = 'dsh-mini.devcli.catalog.v1'

/** 明确写操作（summary 未标「写操作」时兜底）。 */
export const MUTATING_TOOLS = new Set([
  'upload', 'auto_preview', 'build_npm', 'debug_clear_cache',
  'project_import', 'project_remove', 'share_minicode', 'import_minicode',
  'open_project_window', 'close_project_window', 'quit', 'login',
  'simulator_refresh', 'simulator_open_page',
  'cloud_fn_deploy', 'cloud_fn_inc_deploy',
  'cloud_db_write_struct', 'cloud_db_write_doc',
  'cloud_manage_storage', 'cloud_manage_msg_push',
  'automation_element_action', 'automation_page_action', 'automation_wx_api',
  'automation_navigate', 'automation_viewport_action', 'automation_game_action',
  'automation_testaccount', 'automation_evaluate',
])

/** 明确只读（summary 未标「只读」时兜底）。 */
export const READ_ONLY_TOOLS = new Set([
  'check_wechatide_status', 'polling_task_result', 'project_list',
  'get_simulator_console', 'get_simulator_network', 'simulator_screenshot',
  'compile_wxml', 'compile_wxss', 'get_user_appids',
  'cloud_env_list', 'cloud_fn_list', 'cloud_fn_info',
  'cloud_db_read_struct', 'cloud_db_read_doc', 'cloud_query_storage',
  'cloud_query_msg_push', 'automation_runtime_info', 'automation_generate_script',
])

export function inferReadOnly(name, text = '') {
  if (MUTATING_TOOLS.has(name)) return false
  if (READ_ONLY_TOOLS.has(name)) return true
  // 否定式（「不是只读查询」）不得误判为只读
  const t = String(text).replace(/不是只读|非只读|not\s+read[- ]?only/gi, '')
  if (/只读/.test(t)) return true
  if (/写操作/.test(t)) return false
  return undefined
}

export function normalizeMcpTools(tools = []) {
  return tools.map((t) => {
    const name = String(t.name ?? '')
    const description = String(t.description ?? '')
    return {
      name,
      group: name.split('_')[0] || 'other',
      scenes: [],
      summary: '',
      description,
      inputSchema: t.inputSchema ?? {},
      skillSchema: undefined,
      transport: 'mcp',
      readOnly: inferReadOnly(name, description),
      deprecated: /已废弃|deprecated/i.test(description),
      sources: ['mcp'],
    }
  })
}

export function normalizeSkillTools(tools = []) {
  return tools.map((t) => {
    const name = String(t.id ?? '')
    const summary = String(t.summary ?? '')
    return {
      name,
      group: String(t.group ?? name.split('_')[0] ?? 'other'),
      scenes: Array.isArray(t.scenes) ? [...t.scenes] : [],
      summary,
      description: '',
      inputSchema: undefined,
      skillSchema: t.inputSchema ?? {},
      transport: t.execution?.transport ?? 'skill_call',
      readOnly: inferReadOnly(name, summary),
      deprecated: /已废弃|deprecated/i.test(summary),
      sources: ['skill'],
    }
  })
}

function mergeOne(a, b) {
  const summary = a.summary || b.summary
  const description = a.description || b.description
  const inputSchema = a.inputSchema ?? b.inputSchema
  const skillSchema = a.skillSchema ?? b.skillSchema
  const readOnly = a.readOnly === false || b.readOnly === false
    ? false
    : (a.readOnly ?? b.readOnly)
  return {
    name: a.name || b.name,
    // skill 的 group 是人工分组（ide/project-action/automator…），优先于 MCP 名前缀
    group: b.group || a.group,
    scenes: [...new Set([...(a.scenes ?? []), ...(b.scenes ?? [])])],
    summary,
    description,
    inputSchema,
    skillSchema,
    transport: a.transport === 'mcp' && b.transport !== 'mcp' ? b.transport : a.transport,
    readOnly,
    deprecated: Boolean(a.deprecated || b.deprecated),
    sources: [...new Set([...(a.sources ?? []), ...(b.sources ?? [])])],
  }
}

/** 合并多份目录：同名工具合并 sources/scenes，schema 优先 MCP，summary 优先 skill。 */
export function mergeCatalogs(...catalogs) {
  const map = new Map()
  for (const list of catalogs) {
    for (const t of list ?? []) {
      if (t?.name === undefined || t.name === '') continue
      const prev = map.get(t.name)
      map.set(t.name, prev === undefined ? t : mergeOne(prev, t))
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function stable(v) {
  try { return JSON.stringify(v ?? null) } catch { return String(v) }
}

/** 目录差分：DevTools 升级后跑一次，检出增/删/语义变化。 */
export function diffCatalogs(prev = [], next = []) {
  const p = new Map(prev.map((t) => [t.name, t]))
  const n = new Map(next.map((t) => [t.name, t]))
  const added = [...n.keys()].filter((k) => !p.has(k)).sort()
  const removed = [...p.keys()].filter((k) => !n.has(k)).sort()
  const changed = []
  for (const [name, a] of p) {
    const b = n.get(name)
    if (b === undefined) continue
    const fields = []
    if (stable(a.summary) !== stable(b.summary)) fields.push('summary')
    if (stable(a.description) !== stable(b.description)) fields.push('description')
    if (stable(a.inputSchema) !== stable(b.inputSchema)) fields.push('inputSchema')
    if (stable(a.skillSchema) !== stable(b.skillSchema)) fields.push('skillSchema')
    if (a.readOnly !== b.readOnly) fields.push('readOnly')
    if (a.deprecated !== b.deprecated) fields.push('deprecated')
    if (stable(a.scenes) !== stable(b.scenes)) fields.push('scenes')
    if (fields.length > 0) changed.push({ name, fields })
  }
  return { added, removed, changed }
}

export function loadSkillCatalog() {
  return normalizeSkillTools(readSkillTools().tools ?? [])
}

export async function loadMcpCatalog(mcp) {
  const r = await mcp.rpc('tools/list', {}, 15000)
  return normalizeMcpTools(r?.result?.tools ?? [])
}

/** 统一装载：mcp 可用则合并 MCP+skill；否则 skill-only。 */
export async function loadCatalog({ mcp, via } = {}) {
  const skill = loadSkillCatalog()
  if (via === 'skill' || mcp === undefined || mcp === null) return skill
  const mcpCat = await loadMcpCatalog(mcp)
  return mergeCatalogs(mcpCat, skill)
}

export function catalogCachePath(root = REPO_ROOT) {
  return `${root}/.anote/dev-cli/catalog.json`
}

export function writeCatalogCache(catalog, meta = {}, root = REPO_ROOT) {
  const path = catalogCachePath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    schema: CATALOG_SCHEMA,
    savedAt: new Date().toISOString(),
    meta,
    tools: catalog,
  }, null, 2) + '\n')
  return path
}

export function readCatalogCache(root = REPO_ROOT) {
  try {
    const j = JSON.parse(readFileSync(catalogCachePath(root), 'utf8'))
    return Array.isArray(j.tools) ? j.tools : null
  } catch { return null }
}

export function diffAgainstCache(catalog, root = REPO_ROOT) {
  const prev = readCatalogCache(root)
  if (prev === null) return { baseline: false, added: [], removed: [], changed: [] }
  return { baseline: true, ...diffCatalogs(prev, catalog) }
}

export function toolByName(catalog, name) {
  return (catalog ?? []).find((t) => t.name === name)
}

export function groupCatalog(catalog, by = 'group') {
  const groups = {}
  for (const t of catalog ?? []) {
    const keys = by === 'scene' ? (t.scenes?.length ? t.scenes : ['(unscened)']) : [t.group ?? 'other']
    for (const k of keys) (groups[k] ??= []).push(t)
  }
  return groups
}

export function summarizeCatalog(catalog) {
  const list = catalog ?? []
  const readOnly = list.filter((t) => t.readOnly === true).length
  const mutating = list.filter((t) => t.readOnly === false).length
  const deprecated = list.filter((t) => t.deprecated).length
  return {
    total: list.length,
    readOnly,
    mutating,
    unknown: list.length - readOnly - mutating,
    deprecated,
    groups: new Set(list.map((t) => t.group)).size,
    scenes: new Set(list.flatMap((t) => t.scenes)).size,
  }
}

export function formatTool(t, { full = false } = {}) {
  const rw = t.readOnly === true ? 'R' : t.readOnly === false ? 'W' : '?'
  const dep = t.deprecated ? ' [deprecated]' : ''
  const scenes = t.scenes?.length ? ` {${t.scenes.join(',')}}` : ''
  const head = `${rw} ${t.name}${dep}${scenes}`
  if (!full) return head
  const text = t.summary || t.description || ''
  return `${head}\n    ${text.replace(/\s+/g, ' ').slice(0, 220)}`
}
