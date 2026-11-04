/** `/` 指令目录:dsh-mini 可执行的客户端命令与匹配规则(every consumer 共用)。 */

export type CommandSection = 'add' | 'commands'

export interface CommandDefinition {
  id: string
  name: string
  label: string
  description: string
  icon: string
  section: CommandSection
}

export const COMMANDS: CommandDefinition[] = [
  { id: 'file', name: 'file', label: '文件', description: '', icon: 'paperclip-outline', section: 'add' },
  { id: 'goal', name: 'goal', label: '目标', description: '设置或查看长期任务目标', icon: 'checklist-outline', section: 'add' },
  { id: 'plan', name: 'plan', label: '计划', description: '进入或退出计划模式', icon: 'plan-outline', section: 'add' },
  { id: 'feedback', name: 'feedback', label: '反馈', description: '发送关于当前会话的反馈', icon: 'paper-plane-outline', section: 'add' },
  { id: 'compact', name: 'compact', label: '压缩', description: '压缩以上对话内容', icon: 'layers-outline', section: 'commands' },
  { id: 'permission', name: 'permission', label: '权限', description: '切换权限预设（沙箱模式与审批策略）', icon: 'shield-outline', section: 'commands' },
  { id: 'model', name: 'model', label: '模型', description: '选择本会话使用的模型', icon: 'sparkle', section: 'commands' },
  { id: 'export', name: 'export', label: '导出', description: '将当前会话内容导出为 ZIP', icon: 'share-outline', section: 'commands' },
]

function rank(row: CommandDefinition, keyword: string): number {
  const label = row.label.toLowerCase()
  const name = row.name.toLowerCase()
  const description = row.description.toLowerCase()
  if (label.startsWith(keyword) || name.startsWith(keyword)) return 0
  if (label.includes(keyword) || name.includes(keyword)) return 1
  if (description.includes(keyword)) return 2
  return -1
}

/** 按 dsh 的名称/标签排序规则过滤;空查询返回目录顺序。 */
export function filterCommands(query: string): CommandDefinition[] {
  const keyword = query.trim().toLowerCase()
  if (keyword.length === 0) return [...COMMANDS]
  return COMMANDS
    .map((row) => ({ row, score: rank(row, keyword) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.row)
}

/** 高亮/回车选中的第一条匹配指令。 */
export function firstCommand(query: string): CommandDefinition | undefined {
  return filterCommands(query)[0]
}
