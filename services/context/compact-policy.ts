/**
 * watermark / default。百分比只来自 kernel 的 DEFAULT_COMPACT_POLICY。
 * 本文件不写水位数字。source:"default" 不映射 FullCompactTrigger 四词。
 * T-O-23 ②③：这里不发射 notify 六态，也不调用 decideAsyncArm。
 */

import { loadKernel } from '../nano-mini-host/kernel-loader'
import { microcompactToolResults } from './microcompact/index'

const FULL_COMPACT_TRIGGER = ['manual', 'deferred-next-full', 'structural', 'breakthrough'] as const

export type FullCompactTrigger = (typeof FULL_COMPACT_TRIGGER)[number]

export interface CompactNeed {
  required: boolean
  source: 'default' | 'watermark'
  triggerKind?: FullCompactTrigger
}

interface PolicyKernel {
  resolveCompactPolicyDetailed(reader: undefined, args: Record<string, unknown>): Promise<{ source: 'default' | 'watermark'; policy: { softTriggerPct: number; healthTargetPct?: number; disabled?: boolean } }>
  shouldArm(snapshot: { totalTokens: number; maxTokens: number; responseReserveTokens: number }, policy: { disabled?: boolean; softTriggerPct: number }): boolean
  PROTECTED_FRAGMENT_TAGS?: readonly string[]
  decideToolResultFold?(input: {
    turnDistance: number
    estimatedTokens: number
    layer: string | null
    property: 'tool-result' | 'headline' | null
    declared: boolean
    alreadyHeadlined: boolean
  }): { fold: boolean }
  MICRO_STALE_NUM?: number
}

function kernel(): PolicyKernel | undefined {
  const loaded = loadKernel() as Partial<PolicyKernel> | undefined
  if (typeof loaded?.resolveCompactPolicyDetailed !== 'function' || typeof loaded.shouldArm !== 'function') return undefined
  return loaded as PolicyKernel
}

export function isFullCompactTrigger(value: string): value is FullCompactTrigger {
  return (FULL_COMPACT_TRIGGER as readonly string[]).includes(value)
}

/** 无 usage、无窗口、或 source 不是 watermark：不压实。不退回字节长度。 */
export async function evaluateCompact(input: {
  usage?: { inputTokens?: number; outputTokens?: number }
  maxTokens?: number
  responseReserveTokens?: number
  triggerKind?: string
}): Promise<CompactNeed> {
  const loaded = kernel()
  if (loaded === undefined) return { required: false, source: 'default' }
  const resolution = await loaded.resolveCompactPolicyDetailed(undefined, {})
  if (resolution.source !== 'watermark') return { required: false, source: 'default' }
  const inputTokens = input.usage?.inputTokens
  const outputTokens = input.usage?.outputTokens
  if (typeof inputTokens !== 'number' && typeof outputTokens !== 'number') {
    return { required: false, source: 'watermark' }
  }
  if (typeof input.maxTokens !== 'number') return { required: false, source: 'watermark' }
  const total = (typeof inputTokens === 'number' ? inputTokens : 0) + (typeof outputTokens === 'number' ? outputTokens : 0)
  const required = loaded.shouldArm({
    totalTokens: total,
    maxTokens: input.maxTokens,
    responseReserveTokens: input.responseReserveTokens ?? 0,
  }, resolution.policy)
  if (!required || input.triggerKind === undefined || !isFullCompactTrigger(input.triggerKind)) {
    return { required: false, source: 'watermark' }
  }
  return { required: true, source: 'watermark', triggerKind: input.triggerKind }
}

export function protectedTail(messages: readonly unknown[]): unknown[] {
  const tags = new Set(kernel()?.PROTECTED_FRAGMENT_TAGS ?? [])
  return messages.filter((message) => {
    if (message === null || typeof message !== 'object') return false
    const row = message as { kind?: unknown; context_property?: unknown }
    const kind = typeof row.kind === 'string' ? row.kind : ''
    const prop = typeof row.context_property === 'string' ? row.context_property : ''
    return tags.has(kind) || tags.has(prop)
  })
}

/**
 * 没有 currentTurnIndex 就不折：durable ordinal 对不上时记未观察，不新造判词。
 * receipt 留在返回值里，不写 episodes，也不带摘要正文。
 */
export function foldTranscript(
  messages: readonly unknown[],
  currentTurnIndex: number | undefined,
  currentTurnTailLength = 0,
): { readonly messages: readonly unknown[]; readonly receipt: { readonly compactedCount: number; readonly toolCallIds: readonly string[] } | null } {
  if (currentTurnIndex === undefined) return { messages, receipt: null }
  const folded = microcompactToolResults(messages, { currentTurnIndex, currentTurnTailLength })
  return {
    messages: folded.messages,
    receipt: { compactedCount: folded.receipt.compactedCount, toolCallIds: folded.receipt.toolCallIds },
  }
}
