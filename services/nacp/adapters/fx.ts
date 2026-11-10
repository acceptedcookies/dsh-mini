/**
 * fx sessionUpdate → canonical。映射按 T-O-18 ①。
 * usage 三值不齐就不带、不补 0。无 seat 的 kind 挂 system.notify。
 * 不发 compact.notify。本文件不 import services/fx/runtime.ts。
 */

import { projectCanonical } from '../project'
import { type CanonicalEvent, type ToCanonical } from '../types'

const NO_SEAT = new Set(['available_commands_update', 'plan', 'current_mode_update'])

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function textOf(raw: Record<string, unknown>): string {
  const content = raw.content
  if (typeof content === 'string') return content
  if (content !== null && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text
  }
  return ''
}

function usageTriple(raw: Record<string, unknown>): { input_tokens: number; output_tokens: number; total_tokens: number } | undefined {
  const usage = raw.usage !== null && typeof raw.usage === 'object' ? raw.usage as Record<string, unknown> : raw
  const input = usage.input_tokens ?? usage.inputTokens
  const output = usage.output_tokens ?? usage.outputTokens
  const total = usage.total_tokens ?? usage.totalTokens
  if (typeof input !== 'number' || typeof output !== 'number' || typeof total !== 'number') return undefined
  return { input_tokens: input, output_tokens: output, total_tokens: total }
}

export const toCanonical: ToCanonical = (input: unknown): CanonicalEvent => {
  const raw = record(input)
  const sessionUpdate = typeof raw.sessionUpdate === 'string' ? raw.sessionUpdate : typeof raw.kind === 'string' ? raw.kind : ''
  if (NO_SEAT.has(sessionUpdate)) {
    return projectCanonical({
      kind: 'system.notify',
      severity: 'info',
      message: sessionUpdate,
      reason: 'absent',
      absent_reason: 'absent',
    })
  }
  if (sessionUpdate === 'agent_message_chunk') {
    return projectCanonical({ kind: 'llm.delta', content_type: 'text', content: textOf(raw) })
  }
  if (sessionUpdate === 'agent_thought_chunk') {
    return projectCanonical({ kind: 'system.notify', severity: 'info', message: textOf(raw) || 'agent_thought_chunk' })
  }
  if (sessionUpdate === 'tool_call') {
    return projectCanonical({
      kind: 'tool.call',
      tool_name: typeof raw.name === 'string' ? raw.name : 'tool',
      tool_call_id: typeof raw.toolCallId === 'string' ? raw.toolCallId : undefined,
      arguments: raw.rawInput !== null && typeof raw.rawInput === 'object' ? raw.rawInput as Record<string, unknown> : undefined,
      started_at: new Date().toISOString(),
    })
  }
  if (sessionUpdate === 'tool_call_update') {
    const status = typeof raw.status === 'string' ? raw.status : ''
    if (status === 'completed' || status === 'failed') {
      return projectCanonical({
        kind: 'tool.call.result',
        tool_name: typeof raw.name === 'string' ? raw.name : 'tool',
        tool_call_id: typeof raw.toolCallId === 'string' ? raw.toolCallId : undefined,
        result: raw.rawOutput ?? textOf(raw),
      })
    }
    return projectCanonical({
      kind: 'tool.call.progress',
      tool_name: typeof raw.name === 'string' ? raw.name : 'tool',
      request_uuid: typeof raw.toolCallId === 'string' ? raw.toolCallId : undefined,
      chunk: textOf(raw),
      is_final: false,
    })
  }
  if (sessionUpdate === 'usage_update') {
    const usage = usageTriple(raw)
    if (usage === undefined) return projectCanonical({ kind: 'session.update', phase: 'usage' })
    return projectCanonical({ kind: 'turn.end', status: 'completed', usage })
  }
  if (sessionUpdate === 'session_info_update' || sessionUpdate === 'user_message_chunk') {
    return projectCanonical({ kind: 'session.update', phase: sessionUpdate, partial_output: textOf(raw) || undefined })
  }
  if (sessionUpdate === 'notice') {
    return projectCanonical({ kind: 'system.notify', severity: 'info', message: textOf(raw) || 'notice' })
  }
  throw new Error(`canonical kind not wired: ${sessionUpdate}`)
}
