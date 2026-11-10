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
let publishArtifact: ((obj: unknown) => Promise<{ sha256: string } | null>) | undefined
let askUser: ((input: { sessionId: string; text: string }) => Promise<string | null>) | undefined

export function intentNotes(): IntentNote {
  return notes
}

export function setArtifactPublisher(publisher: ((obj: unknown) => Promise<{ sha256: string } | null>) | undefined): void {
  publishArtifact = publisher
}

export function setAskUser(asker: ((input: { sessionId: string; text: string }) => Promise<string | null>) | undefined): void {
  askUser = asker
}

export async function fulfillIntent(text: string, sessionId = ''): Promise<string> {
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
  else if (tool === 'ask_user') {
    const text = input !== null && typeof input === 'object' && typeof (input as { text?: unknown }).text === 'string'
      ? (input as { text: string }).text
      : 'ask_user'
    const answer = askUser === undefined ? null : await askUser({ sessionId, text })
    return answer === null || answer.length === 0 ? 'cancelled ask_user' : `answered ask_user`
  } else if (tool === 'artifact_export') {
    if (publishArtifact === undefined) return 'admitted artifact_export'
    const published = await publishArtifact(input ?? {})
    return published === null ? 'admitted artifact_export' : `published ${published.sha256}`
  }
  // describe_skill / invoke_skill / context_inspect / workspace_verify：不写分区正文。
  return `admitted ${tool}`
}
