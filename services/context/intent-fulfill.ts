/**
 * 截 gtz7i.bash-admitted-intent.v1。envelope 不进模型可见层。
 * skill 结果不写 skill_catalog。workspace_verify 不指定新分区。
 */

export interface IntentNote {
  memory: string[]
  todo: string[]
  fileRead: string[]
}

const notes: IntentNote = { memory: [], todo: [], fileRead: [] }

export function intentNotes(): IntentNote {
  return notes
}

export function fulfillIntent(text: string): string {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    return text
  }
  if (parsed.schema_version !== 'gtz7i.bash-admitted-intent.v1') return text
  const tool = typeof parsed.tool_id === 'string' ? parsed.tool_id : ''
  const input = parsed.input
  if (tool === 'memory') notes.memory.push(JSON.stringify(input ?? {}))
  else if (tool === 'todo') notes.todo.push(JSON.stringify(input ?? {}))
  else if (tool === 'file_focus') notes.fileRead.push(JSON.stringify({ kind: 'file-focus', input }))
  // describe_skill / invoke_skill / context_inspect / workspace_verify：不写分区正文。
  return `admitted ${tool}`
}
