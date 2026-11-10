/**
 * 远端帧 → canonical。17 kind 都接线。fork 三 kind 改写成 system.notify + absent。
 * 不写 episodes。本文件不 import services/fx/runtime.ts。
 */

import { asNotifyIfAbsent, projectCanonical } from '../project'
import { isStreamEventKind, STREAM_EVENT_KINDS, type CanonicalEvent, type StreamEventKind, type ToCanonical } from '../types'

const WIRED: ReadonlySet<StreamEventKind> = new Set(STREAM_EVENT_KINDS)

export function wiredRemoteKinds(): readonly StreamEventKind[] {
  return [...WIRED]
}

export const toCanonical: ToCanonical = (input: unknown): CanonicalEvent => {
  if (input === null || typeof input !== 'object') {
    throw new Error('canonical input is not an object')
  }
  const kind = (input as { kind?: unknown }).kind
  if (!isStreamEventKind(kind) || !WIRED.has(kind)) {
    throw new Error(`canonical kind not wired: ${String(kind)}`)
  }
  return asNotifyIfAbsent(projectCanonical(input))
}

export const REMOTE_RECEIPT_KEYS = ['session_uuid', 'cursor', 'resume_cursor', 'last_event_seq', 'stream_uuid'] as const

/** receipt 只留身份和 cursor。多出来的键丢掉。 */
export function projectReceipt(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of REMOTE_RECEIPT_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}
