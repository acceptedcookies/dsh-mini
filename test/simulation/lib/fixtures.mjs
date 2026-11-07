// 固定可复现的合成数据。不是运行产物，可以入库。
export const SCRIPT = {
  text: 'sim-scripted-reply',
  toolName: 'file_read',
  toolResult: 'sim-tool-ok',
  error: 'sim-upstream-503',
}

export function fileBytes(label = 'sim-file') {
  return Buffer.from(`simulation fixture ${label}\n`, 'utf8')
}

export function stateBody(turn) {
  return JSON.stringify({ sessionId: 'sim-session', turn, marker: 'sim-checkpoint' })
}
