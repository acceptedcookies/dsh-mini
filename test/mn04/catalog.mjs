// L1（Node）：catalog 归一/合并/差分纯函数——不开 IDE。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const {
  normalizeMcpTools, normalizeSkillTools, mergeCatalogs, diffCatalogs,
  summarizeCatalog, inferReadOnly, formatTool,
} = await import(`${ROOT}/scripts/dev-cli/lib/catalog.mjs`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const mcpRaw = [
  { name: 'automation_evaluate', description: '在当前小程序运行时执行一段 JS 函数字符串并返回结果。该工具会实际执行代码，不是只读查询。', inputSchema: { type: 'object', properties: { fnSource: { type: 'string' } } } },
  { name: 'upload', description: '上传代码包(发布体验版)。仅在用户明确要求时调用。', inputSchema: { type: 'object' } },
  { name: 'check_wechatide_status', description: '只读获取登录态。', inputSchema: { type: 'object' } },
  { name: 'project_setting_get', description: '【已废弃】请改用 project.config.json。', inputSchema: { type: 'object' } },
]
const skillRaw = [
  { id: 'automation_evaluate', group: 'automation', scenes: ['automator'], summary: '运行时执行', inputSchema: { project: { type: 'string', required: true }, fnSource: { type: 'string', required: true }, action: { type: 'string', fixed: true } }, execution: { transport: 'skill_call' } },
  { id: 'upload', group: 'project-action', scenes: ['previewer'], summary: '发布体验版', inputSchema: { project: { type: 'string', required: true } }, execution: { transport: 'skill_call' } },
  { id: 'check_wechatide_status', group: 'ide', scenes: ['initializer'], summary: '读取开发者工具状态', inputSchema: { 'skill-version': { type: 'string' } }, execution: { transport: 'skill_call' } },
]

const mcp = normalizeMcpTools(mcpRaw)
const skill = normalizeSkillTools(skillRaw)
const merged = mergeCatalogs(mcp, skill)

check('MCP 归一：group/描述/schema', mcp.length === 4 && mcp[0].group === 'automation' && mcp[0].inputSchema?.properties?.fnSource !== undefined)
check('MCP 归一：写操作 readOnly=false', mcp.find((t) => t.name === 'upload')?.readOnly === false)
check('MCP 归一：否定式「不是只读」不误判', mcp.find((t) => t.name === 'automation_evaluate')?.readOnly === false)
check('MCP 归一：只读 readOnly=true', mcp.find((t) => t.name === 'check_wechatide_status')?.readOnly === true)
check('MCP 归一：废弃标记', mcp.find((t) => t.name === 'project_setting_get')?.deprecated === true)
check('skill 归一：scenes/transport/summary', skill[0].scenes[0] === 'automator' && skill[0].transport === 'skill_call' && skill[0].summary === '运行时执行')
check('skill 归一：fixed 字段保留在 skillSchema', skill[0].skillSchema.action.fixed === true)

const ev = merged.find((t) => t.name === 'automation_evaluate')
check('合并：sources 双源', ev.sources.includes('mcp') && ev.sources.includes('skill'))
check('合并：schema 优先 MCP', ev.inputSchema?.properties?.fnSource !== undefined)
check('合并：skillSchema 保留', ev.skillSchema?.fnSource !== undefined)
check('合并：summary 优先 skill / description 优先 MCP', ev.summary === '运行时执行' && ev.description.includes('JS 函数'))
check('合并：scenes 来自 skill', ev.scenes.includes('automator'))

const diff = diffCatalogs(mcp, [
  ...mcp.filter((t) => t.name !== 'upload'),
  { ...mcp.find((t) => t.name === 'automation_evaluate'), description: 'changed' },
  { name: 'new_tool', group: 'new', scenes: [], summary: '', description: '', inputSchema: {}, transport: 'mcp', readOnly: true, deprecated: false, sources: ['mcp'] },
])
check('diff：added/removed/changed', diff.added.includes('new_tool') && diff.removed.includes('upload') && diff.changed.some((c) => c.name === 'automation_evaluate' && c.fields.includes('description')))

const sum = summarizeCatalog(merged)
check('summary：计数一致', sum.total === 4 && sum.mutating >= 1 && sum.readOnly >= 1 && sum.deprecated === 1)
check('inferReadOnly：未知工具返回 undefined', inferReadOnly('mystery_tool', '') === undefined)
check('formatTool：R/W 标记', formatTool(merged.find((t) => t.name === 'upload')).startsWith('W ') && formatTool(merged.find((t) => t.name === 'check_wechatide_status')).startsWith('R '))

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
