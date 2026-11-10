/**
 * 远端帧 → canonical。未接线 kind 失败，不映射成空，不新造错误码。
 * 接线表在 Phase 7 填满。本文件不 import services/fx/runtime.ts。
 */

import { asNotifyIfAbsent, projectCanonical } from '../project'
import { isStreamEventKind, type CanonicalEvent, type StreamEventKind, type ToCanonical } from '../types'

/** Phase 7 之前保持空集：任何 kind 都算未接线。 */
const WIRED: ReadonlySet<StreamEventKind> = new Set()

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
