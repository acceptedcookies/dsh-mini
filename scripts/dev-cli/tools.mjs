// dev-cli · DevTools 工具目录：MCP tools/list × skill tools.yaml。
// 用法:
//   node scripts/dev-cli/tools.mjs                       分组打印（R=只读 W=写 ?=未标注）
//   node scripts/dev-cli/tools.mjs --json                归一目录（机器可读）
//   node scripts/dev-cli/tools.mjs --full                每条带 summary
//   node scripts/dev-cli/tools.mjs --schema <tool>       单工具 inputSchema
//   node scripts/dev-cli/tools.mjs --scenes              按 scene 分组
//   node scripts/dev-cli/tools.mjs --diff                对比 .anote/dev-cli/catalog.json
//   node scripts/dev-cli/tools.mjs --refresh             写目录缓存（升级后跑）
//   node scripts/dev-cli/tools.mjs --via skill           只读 skill 目录（不开 MCP 桥）
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag } from './lib/args.mjs'
import {
  groupCatalog, summarizeCatalog, formatTool, diffAgainstCache,
  writeCatalogCache, toolByName,
} from './lib/catalog.mjs'
import { runMain } from './lib/report.mjs'

const { flags } = parseArgs()
const json = boolFlag(flags, 'json')
const full = boolFlag(flags, 'full')
const scenes = boolFlag(flags, 'scenes')
const refresh = boolFlag(flags, 'refresh')
const diff = boolFlag(flags, 'diff')
const schemaName = flagOf(flags, 'schema', null)
const via = flagOf(flags, 'via', undefined)

await runMain('tools', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    const catalog = await d.catalog({ refresh: true })
    if (schemaName !== null) {
      const t = toolByName(catalog, schemaName)
      if (t === undefined) throw new Error(`未知工具 '${schemaName}'——先 tools.mjs | grep`)
      return { tool: t.name, summary: t.summary || t.description, inputSchema: t.inputSchema, skillSchema: t.skillSchema, readOnly: t.readOnly, scenes: t.scenes }
    }
    if (refresh) {
      const path = writeCatalogCache(catalog, { via: d.channel })
      return { cached: path, summary: summarizeCatalog(catalog) }
    }
    if (diff) {
      return { summary: summarizeCatalog(catalog), diff: diffAgainstCache(catalog) }
    }
    if (json) return { summary: summarizeCatalog(catalog), tools: catalog }
    const groups = groupCatalog(catalog, scenes ? 'scene' : 'group')
    return {
      summary: summarizeCatalog(catalog),
      groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([g, list]) => [g, list.map((t) => formatTool(t, { full }))])),
    }
  } finally {
    await d.close()
  }
}, { json })
