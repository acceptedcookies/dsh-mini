/**
 * 直搬 context-core microcompact/decide.ts。阈值常量不改：
 * MICRO_STALE_NUM = 3，MICRO_INLINE_MAX_TOKENS = 40000 / 4。
 * estimateTokens 仍是 ceil(utf8Bytes / 4)，与 nacp-core estimateUtf8Tokens 同式。
 */
import { encodeUtf8 } from '../../fx/utf8'

export const TOOL_RESULT_INLINE_MAX_BYTES = 40_000
export const MICRO_STALE_NUM = 3
export const MICRO_INLINE_MAX_TOKENS = TOOL_RESULT_INLINE_MAX_BYTES / 4

function utf8ByteLength(text: string): number {
  return encodeUtf8(text).byteLength
}

export function estimateTokens(value: unknown): number {
  const text = stringifyContent(value)
  if (!text) return 0
  return Math.ceil(utf8ByteLength(text) / 4)
}

export function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export type ToolResultFoldReason =
  | 'stale'
  | 'inline-max'
  | 'idempotent-skip'
  | 'threshold-skip'
  | 'not-eligible'

export interface ToolResultFoldInput {
  readonly turnDistance: number
  readonly estimatedTokens: number
  readonly layer: string | null
  readonly property: 'tool-result' | 'headline' | null
  readonly declared: boolean
  readonly alreadyHeadlined: boolean
  readonly inlineMax?: number
}

export interface ToolResultFoldDecision {
  readonly eligible: boolean
  readonly fold: boolean
  readonly reason: ToolResultFoldReason
  readonly overInline: boolean
  readonly stale: boolean
}

export function decideToolResultFold(input: ToolResultFoldInput): ToolResultFoldDecision {
  const inlineMax = input.inlineMax ?? MICRO_INLINE_MAX_TOKENS
  if (!input.declared || input.layer !== 'transcript' || input.property !== 'tool-result') {
    return { eligible: false, fold: false, reason: 'not-eligible', overInline: false, stale: false }
  }
  const overInline = input.estimatedTokens > inlineMax
  const stale = input.turnDistance >= MICRO_STALE_NUM
  if (input.alreadyHeadlined) {
    return { eligible: true, fold: false, reason: 'idempotent-skip', overInline, stale }
  }
  const fold = overInline || stale
  return {
    eligible: true,
    fold,
    reason: fold ? (overInline ? 'inline-max' : 'stale') : 'threshold-skip',
    overInline,
    stale,
  }
}
