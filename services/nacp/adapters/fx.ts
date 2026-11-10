/**
 * fx sessionUpdate → canonical。未接线 kind 失败，不映射成空。
 * 映射表在 Phase 7 按 T-O-18 ① 填。本文件不 import services/fx/runtime.ts。
 */

import { asNotifyIfAbsent, projectCanonical } from '../project'
import { isStreamEventKind, type CanonicalEvent, type StreamEventKind, type ToCanonical } from '../types'

const WIRED: ReadonlySet<StreamEventKind> = new Set()

export function wiredFxKinds(): readonly StreamEventKind[] {
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
