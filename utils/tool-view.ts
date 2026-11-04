/** Presentation projection for one tool-call row (dsh ui-tool GenericToolCard). */
export interface ToolView {
  icon: string
  title: string
  summary: string
  running: boolean
  failed: boolean
  stopped: boolean
  input: string
  output: string
  expandable: boolean
  sourceSeq?: number
}

type ToolVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

interface ToolItem {
  kind: string
  seq?: number
  tool?: string
  status?: string
  title?: string
  summary?: string
  detail?: string
  args?: string
}

const VARIANT_BY_TOOL: Record<string, ToolVariant> = {
  bash: 'bash',
  shell: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  file_read: 'read',
  file_stat: 'read',
  file_list: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  search: 'search',
  write: 'write',
  file_write: 'write',
  edit: 'edit',
  apply_patch: 'edit',
  file_remove: 'edit',
  run_code: 'code',
}

const VARIANT_TITLES: Record<ToolVariant, string> = {
  search: '搜索',
  read: '读取',
  bash: '运行命令',
  write: '写入',
  edit: '编辑',
  code: '代码',
  others: '工具调用',
}

const TOOL_TITLES: Record<string, string> = {
  apply_patch: '应用补丁',
  read_image: '读取图片',
  file_list: '列出文件',
  file_remove: '删除文件',
  web_search: '网页搜索',
  web_fetch: '网页获取',
  grep: '搜索文件内容',
  glob: '查找文件',
  run_code: '代码',
  todo_write: '待办',
  ask_user_question: '提问',
}

const VARIANT_ICONS: Record<ToolVariant, string> = {
  search: 'search-outline',
  read: 'browse-outline',
  bash: 'api-outline',
  write: 'edit-outline',
  edit: 'edit-outline',
  code: 'code-outline',
  others: 'sparkle',
}

const SUMMARY_KEYS: Record<ToolVariant, readonly string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

function firstLine(value: string): string {
  const line = value.split('\n')[0] ?? ''
  return line.trim()
}

function parseArgs(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }
  return undefined
}

function deriveSummary(variant: ToolVariant, item: ToolItem): string {
  const args = parseArgs(item.args)
  if (args === undefined) {
    if (item.args !== undefined && item.args.trim().length > 0) return firstLine(item.args)
    return ''
  }
  if (variant === 'search' && Array.isArray(args.queries)) {
    const queries = args.queries.filter((query): query is string => typeof query === 'string' && query.length > 0)
    if (queries.length > 0) return queries.map(firstLine).join('，')
  }
  for (const key of SUMMARY_KEYS[variant]) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return firstLine(value)
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.length > 0) return firstLine(value)
  }
  return ''
}

function formatBody(raw: string | undefined, variant: ToolVariant): string {
  if (raw === undefined || raw.trim().length === 0) return ''
  const args = parseArgs(raw)
  if (args === undefined) return raw
  if (variant === 'code') {
    const code = args.code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return JSON.stringify(args, null, 2)
}

function isSameText(left: string, right: string | undefined): boolean {
  return right !== undefined && left.trim() === right.trim()
}

/** Project a ChatItem tool row into its dsh row title, summary, and body. */
export function toolView(item: ToolItem): ToolView {
  const tool = item.tool ?? ''
  const variant = VARIANT_BY_TOOL[tool] ?? 'others'
  const toolTitle = TOOL_TITLES[tool] ?? VARIANT_TITLES[variant]
  const base = deriveSummary(variant, item)
  const fallback = item.title !== undefined && item.title !== tool ? firstLine(item.title) : ''
  const summary = base.length > 0 ? base : fallback.length > 0 ? fallback : firstLine(item.summary ?? '')
  const prefix = variant === 'others' && tool.length > 0 && toolTitle === VARIANT_TITLES.others
    ? tool
    : ''
  const input = formatBody(item.args, variant)
  const settled = item.status === 'ok' || item.status === 'error'
  const detail = settled && item.detail !== undefined ? item.detail : ''
  const output = isSameText(detail, item.args) ? '' : detail
  const error = item.status === 'error'
  const summaryText = error && output.length > 0
    ? firstLine(output)
    : [prefix, summary].filter((part) => part.length > 0).join(' · ')
  return {
    icon: VARIANT_ICONS[variant],
    title: toolTitle,
    summary: summaryText,
    running: item.status === 'running',
    failed: error,
    stopped: item.status === 'stopped',
    input,
    output: settled ? output : '',
    expandable: input.length > 0 || output.length > 0,
    ...(typeof item.seq === 'number' ? { sourceSeq: item.seq } : {}),
  }
}
