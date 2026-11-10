/** 把未知输入收成闭集 CanonicalEvent。多出来的键丢掉，不进索引袋。 */

import {
  CANONICAL_KEYS,
  type CanonicalEvent,
  type StreamEventKind,
  isStreamEventKind,
  isUpstreamAbsentKind,
} from './types'

export function projectCanonical(input: unknown): CanonicalEvent {
  if (input === null || typeof input !== 'object') {
    throw new Error('canonical input is not an object')
  }
  const raw = input as Record<string, unknown>
  if (!isStreamEventKind(raw.kind)) {
    throw new Error(`unknown canonical kind: ${String(raw.kind)}`)
  }
  const out: Record<string, unknown> = { kind: raw.kind }
  for (const key of CANONICAL_KEYS) {
    if (key === 'kind') continue
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out as unknown as CanonicalEvent
}

/** fork 三 kind 不实现业务：改写成 system.notify，reason 固定 absent。 */
export function asNotifyIfAbsent(event: CanonicalEvent): CanonicalEvent {
  if (!isUpstreamAbsentKind(event.kind)) return event
  const kind: StreamEventKind = event.kind
  return {
    kind: 'system.notify',
    session_uuid: event.session_uuid,
    event_uuid: event.event_uuid,
    trace_uuid: event.trace_uuid,
    turn_uuid: event.turn_uuid,
    severity: 'info',
    message: kind,
    reason: 'absent',
  }
}
