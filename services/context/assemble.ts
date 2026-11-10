/**
 * 一次装配。未注册 kind 报错，不归桶。不在这里写第二份系统提示正文。
 */

import { loadKernel } from '../nano-mini-host/kernel-loader'
import { canonicalToolEnvelope, isBashKernel } from '../nano-mini-host/io/bash-exec'
import { partitionSlots } from './partitions'
import { applyCanonicalPrompt, type PromptKernel } from './system-prompt'
import { decodeSteering, type SteeringUnit } from './steering'
import { intentNotes } from './intent-fulfill'

export interface AssembledContext {
  messages: readonly unknown[]
  tools: readonly unknown[]
  allowedToolIds: readonly string[]
  partitions: Readonly<Record<string, { bytes: string; degradedReason?: string }>>
  steering: SteeringUnit | null
}

interface RegistryKernel extends PromptKernel {
  PROVIDER_FINAL_PARTITIONS: readonly string[]
  PROVIDER_FINAL_STRICT_KIND_LAYERS: readonly string[]
  resolveContextComponent(layer: string | null, kind: string | null): { kind?: string } | undefined
  withModelSteering(messages: readonly unknown[], steering: SteeringUnit | null): readonly unknown[]
}

function isRegistryKernel(value: unknown): value is RegistryKernel {
  if (value === null || typeof value !== 'object') return false
  const row = value as Partial<RegistryKernel>
  return typeof row.withNanoAgentSystemPrompt === 'function'
    && typeof row.withModelSteering === 'function'
    && Array.isArray(row.PROVIDER_FINAL_PARTITIONS)
    && typeof row.resolveContextComponent === 'function'
}

function assertRegistered(kernel: RegistryKernel, messages: readonly unknown[]): void {
  const strict = new Set(kernel.PROVIDER_FINAL_STRICT_KIND_LAYERS)
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    const row = message as Record<string, unknown>
    const layer = typeof row.context_layer === 'string' ? row.context_layer : null
    const kind = typeof row.kind === 'string' ? row.kind : null
    if (layer !== null && strict.has(layer)) {
      if (kernel.resolveContextComponent(layer, kind) === undefined) {
        throw new Error(`kind not in registry: ${String(kind)}`)
      }
    }
  }
}

export function assemble(input: {
  transcript: readonly unknown[]
  steering?: unknown
  canonicalTextOverride?: string
}): AssembledContext {
  const loaded = loadKernel()
  if (!isRegistryKernel(loaded) || !isBashKernel(loaded)) {
    throw new Error('kernel assembly surface unavailable')
  }
  const steering = decodeSteering(input.steering)
  const rows = loaded.BASH_TOOL_CONTRACT_SOURCE
  const allowedToolIds = rows.map((row) => row.canonical_id)
  const tools = canonicalToolEnvelope(rows)
  assertRegistered(loaded, input.transcript)
  const prompted = applyCanonicalPrompt(loaded, input.transcript, new Set(allowedToolIds), input.canonicalTextOverride)
  const messages = loaded.withModelSteering(prompted, steering)
  assertRegistered(loaded, messages)
  const partitions = partitionSlots(loaded.PROVIDER_FINAL_PARTITIONS)
  if (partitions.transcript !== undefined) partitions.transcript = { bytes: '' }
  if (partitions.tool_schema !== undefined) partitions.tool_schema = { bytes: JSON.stringify(allowedToolIds) }
  const canonical = messages.find((message) => loaded.isCanonicalPromptMessage(message)) as { content?: unknown } | undefined
  if (partitions.canonical_system_prompt !== undefined && typeof canonical?.content === 'string') {
    partitions.canonical_system_prompt = { bytes: canonical.content }
  }
  if (partitions.model_steering !== undefined && steering !== null) {
    partitions.model_steering = { bytes: steering.content }
  }
  const noted = intentNotes()
  if (partitions.memory !== undefined && noted.memory.length > 0) partitions.memory = { bytes: noted.memory.join('\n') }
  if (partitions.todo !== undefined && noted.todo.length > 0) partitions.todo = { bytes: noted.todo.join('\n') }
  if (partitions.file_read !== undefined && noted.fileRead.length > 0) partitions.file_read = { bytes: noted.fileRead.join('\n') }
  if (partitions.skill_catalog !== undefined) partitions.skill_catalog = { bytes: '', degradedReason: partitions.skill_catalog.degradedReason }
  return { messages, tools, allowedToolIds, partitions, steering }
}
