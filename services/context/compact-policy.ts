/**
 * watermark / default。百分比只来自 kernel 的 DEFAULT_COMPACT_POLICY。
 * 本文件不写水位数字。source:"default" 不映射 FullCompactTrigger 四词。
 * T-O-23 ②③：这里不发射 notify 六态，也不调用 decideAsyncArm。
 */

import { loadKernel } from '../nano-mini-host/kernel-loader'

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

/** 缺 source_turn_index 不对 durable ordinal：不折、不记新判词。不写 episodes。 */
export function foldTranscript(messages: readonly unknown[], currentTurnIndex: number | undefined): unknown[] {
  const loaded = kernel()
  if (loaded?.decideToolResultFold === undefined) return [...messages]
  return messages.map((message) => {
    if (message === null || typeof message !== 'object') return message
    const row = message as Record<string, unknown>
    if (typeof row.source_turn_index !== 'number' || currentTurnIndex === undefined) return message
    const decision = loaded.decideToolResultFold!({
      turnDistance: currentTurnIndex - row.source_turn_index,
      estimatedTokens: 0,
      layer: row.context_layer === 'transcript' ? 'transcript' : null,
      property: row.context_property === 'tool-result' ? 'tool-result' : null,
      declared: row.declared === true,
      alreadyHeadlined: row.alreadyHeadlined === true,
    })
    if (!decision.fold) return message
    return { ...row, content: '', alreadyHeadlined: true }
  })
}
