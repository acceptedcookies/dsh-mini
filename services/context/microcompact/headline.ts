/**
 * 直搬 headline 前缀。正文来自 nacp-core system-text：
 * compaction.headline / compaction.cleared。不改这两个字节。
 */

export const MICRO_HEADLINE_MARKER_PREFIX = '[micro tool-result headline:'
const TOOL_RESULT_PLACEHOLDER_PREFIX = '[Old tool result content cleared; tool_call_id='

function lineCount(text: string): number {
  if (text.length === 0) return 0
  let count = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1
  }
  return count
}

export function toolResultHeadline(input: { readonly toolName: string; readonly content: string; readonly status: string }): string {
  const lines = lineCount(input.content)
  const bytes = new TextEncoder().encode(input.content).byteLength
  return `${MICRO_HEADLINE_MARKER_PREFIX} tool=${input.toolName} status=${input.status} lines=${lines} bytes=${bytes}]`
}

export function toolResultPlaceholder(toolCallId: string): string {
  return `${TOOL_RESULT_PLACEHOLDER_PREFIX}${toolCallId}]`
}

export function isAlreadyHeadlined(content: string): boolean {
  return content.startsWith(MICRO_HEADLINE_MARKER_PREFIX)
}
