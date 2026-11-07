// dev-cli · DevTools 工具目录缓存/差分（AI 增强形态的升级哨兵）。
// 用法:
//   node scripts/dev-cli/catalog.mjs                 摘要 + 分组
//   node scripts/dev-cli/catalog.mjs --full          每条带 summary
//   node scripts/dev-cli/catalog.mjs --json          归一目录全量
//   node scripts/dev-cli/catalog.mjs --tool <name>   单工具
//   node scripts/dev-cli/catalog.mjs --refresh       写 .anote/dev-cli/catalog.json
//   node scripts/dev-cli/catalog.mjs --diff          对比缓存（升级后跑）
//   node scripts/dev-cli/catalog.mjs --via skill     只读 skill 目录
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, boolFlag, flagOf } from './lib/args.mjs'
import {
  groupCatalog, summarizeCatalog, formatTool, diffAgainstCache,
  writeCatalogCache, toolByName,
} from './lib/catalog.mjs'
import { runMain } from './lib/report.mjs'

const { flags } = parseArgs()
const json = boolFlag(flags, 'json')
const full = boolFlag(flags, 'full')
const refresh = boolFlag(flags, 'refresh')
const diff = boolFlag(flags, 'diff')
const name = flagOf(flags, 'tool', null)
const via = flagOf(flags, 'via', undefined)

await runMain('catalog', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    const catalog = await d.catalog({ refresh: true })
    if (name !== null) {
      const t = toolByName(catalog, name)
      if (t === undefined) throw new Error(`未知工具 '${name}'`)
      return t
    }
    if (refresh) {
      const path = writeCatalogCache(catalog, { via: d.channel })
      return { cached: path, summary: summarizeCatalog(catalog) }
    }
    if (diff) return { summary: summarizeCatalog(catalog), diff: diffAgainstCache(catalog) }
    if (json) return { summary: summarizeCatalog(catalog), tools: catalog }
    const groups = groupCatalog(catalog)
    return {
      summary: summarizeCatalog(catalog),
      groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([g, list]) => [g, list.map((t) => formatTool(t, { full }))])),
    }
  } finally {
    await d.close()
  }
}, { json })
