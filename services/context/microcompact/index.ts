/**
 * 请求内折叠。只回写 transcript。receipt 只有计数、id 和 ref，没有摘要正文。
 * 不写 episodes。缺 durable ordinal 时调用方不要传 currentTurnIndex。
 */

import { decideToolResultFold, estimateTokens, MICRO_INLINE_MAX_TOKENS, MICRO_STALE_NUM, stringifyContent } from './decide'
import { isAlreadyHeadlined, toolResultHeadline, toolResultPlaceholder } from './headline'

export { decideToolResultFold, estimateTokens, MICRO_INLINE_MAX_TOKENS, MICRO_STALE_NUM, stringifyContent } from './decide'
export { isAlreadyHeadlined, MICRO_HEADLINE_MARKER_PREFIX, toolResultHeadline, toolResultPlaceholder } from './headline'

export const PERSISTED_OUTPUT_THRESHOLD_BYTES = 50 * 1024
export const MICROCOMPACT_TRANSCRIPT_REF_PREFIX = 'transcript:tool_result:'

export function microcompactTranscriptRef(toolCallId: string): string {
  return `${MICROCOMPACT_TRANSCRIPT_REF_PREFIX}${toolCallId}`
}

export interface MicroReceipt {
  readonly compactedCount: number
  readonly toolCallIds: readonly string[]
  readonly replacementRefs: readonly string[]
  readonly idempotentSkips: number
  readonly thresholdSkips: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function microcompactToolResults(
  messages: readonly unknown[],
  options: { readonly currentTurnIndex: number; readonly currentTurnTailLength: number },
): { readonly messages: readonly unknown[]; readonly receipt: MicroReceipt } {
  const tailStart = Math.max(0, Math.min(messages.length - Math.max(0, options.currentTurnTailLength), messages.length))
  const toolCallIds: string[] = []
  const replacementRefs: string[] = []
  let compactedCount = 0
  let idempotentSkips = 0
  let thresholdSkips = 0
  const next = messages.map((message, index) => {
    if (!isRecord(message) || message.role !== 'tool') return message
    const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id
      : typeof message.toolCallId === 'string' ? message.toolCallId : ''
    if (toolCallId.length === 0) return message
    const content = stringifyContent(message.content)
    const declared = message.declared === true && message.context_layer === 'transcript' && message.context_property === 'tool-result'
    let turnDistance = 0
    if (index < tailStart) {
      const source = typeof message.source_turn_index === 'number' && Number.isFinite(message.source_turn_index)
        ? Math.trunc(message.source_turn_index)
        : null
      turnDistance = source === null || !Number.isFinite(options.currentTurnIndex)
        ? MICRO_STALE_NUM
        : Math.max(0, Math.trunc(options.currentTurnIndex) - source)
    }
    const decision = decideToolResultFold({
      turnDistance,
      estimatedTokens: estimateTokens(content),
      layer: declared ? 'transcript' : null,
      property: declared ? 'tool-result' : null,
      declared,
      alreadyHeadlined: isAlreadyHeadlined(content),
    })
    if (!decision.eligible) return message
    if (decision.reason === 'idempotent-skip') {
      idempotentSkips += 1
      return message
    }
    if (!decision.fold) {
      thresholdSkips += 1
      return message
    }
    compactedCount += 1
    toolCallIds.push(toolCallId)
    const ref = microcompactTranscriptRef(toolCallId)
    replacementRefs.push(ref)
    const toolName = typeof message.name === 'string' ? message.name : 'tool'
    return {
      ...message,
      content: toolResultHeadline({ toolName, content, status: decision.reason }),
      replacement_ref: ref,
      placeholder: toolResultPlaceholder(toolCallId),
    }
  })
  return {
    messages: next,
    receipt: { compactedCount, toolCallIds, replacementRefs, idempotentSkips, thresholdSkips },
  }
}
