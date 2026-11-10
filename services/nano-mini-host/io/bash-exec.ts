/**
 * 宿主侧 bash-core 注入缝。符号来自 kernel 平铺导出，不复制 spike adapter。
 * vfs 仍是唯一 backend；本文件不定义第二套文件系统类型。
 */

import { vfs } from '../../vfs/vfs'
import { VfsError } from '../../vfs/paths'
import { decide } from '../../permissions'
import { egressDecision } from '../../config'
import type { ToolCallResult } from '../types'

export interface ContractRow {
  canonical_id: string
  description: string
  input_schema: unknown
}

export interface BashKernel {
  CapabilityExecutor: new (
    targets: Map<string, unknown>,
    policy: unknown,
    options?: {
      timeoutMs?: number
      permissionAuthorizer?: {
        authorize(ctx: { plan: { capabilityName: string }; requestId: string }): Promise<{ verdict: 'allow' | 'deny'; handlerCount: number; reason?: string }>
      }
      permissionContextProvider?: () => { sessionUuid?: string; turnUuid?: string; traceUuid?: string }
    },
  ) => { execute(plan: unknown, ctx: unknown): Promise<{ result: ToolCallResult }> }
  planFromToolCall(name: string, args: unknown, registry: { has(name: string): boolean }): unknown
  InMemoryCapabilityRegistry: new () => { has(name: string): boolean }
  LocalTsTarget: new () => { registerHandler(name: string, handler: unknown): void }
  CapabilityPolicyGate: new (registry: unknown) => unknown
  registerMinimalCommands(registry: unknown): void
  BASH_TOOL_CONTRACT_SOURCE: readonly ContractRow[]
  createFilesystemHandlers(config: unknown): Map<string, unknown>
  createSearchHandlers(config: unknown): Map<string, unknown>
  createFindHandlers(config: unknown): Map<string, unknown>
  createTextProcessingHandlers(): Map<string, unknown>
  createUtilHandlers(): Map<string, unknown>
  createTeeHandlers(): Map<string, unknown>
  createNetworkHandlers(config: unknown): Map<string, unknown>
  createExecHandlers(): Map<string, unknown>
  createVcsHandlers(): Map<string, unknown>
  createTextOutputHandlers(): Map<string, unknown>
  createTimeHandlers(): Map<string, unknown>
  createWhichHandlers(): Map<string, unknown>
  createStatHandlers(config: unknown): Map<string, unknown>
  createTreeHandlers(config: unknown): Map<string, unknown>
  createToolIntentHandlers(): Map<string, unknown>
  createPipelineHandlers(config: { registry: unknown }): Map<string, unknown>
  FakeBashBridge: new (...args: unknown[]) => unknown
  planBashLine: unknown
}

export function isBashKernel(value: unknown): value is BashKernel {
  if (value === null || typeof value !== 'object') return false
  const row = value as Partial<BashKernel>
  return typeof row.planFromToolCall === 'function'
    && typeof row.BASH_TOOL_CONTRACT_SOURCE !== 'undefined'
    && typeof row.createFilesystemHandlers === 'function'
}

export function canonicalToolEnvelope(rows: readonly ContractRow[]) {
  return rows.map((row) => ({
    type: 'function' as const,
    function: {
      name: row.canonical_id,
      description: row.description,
      parameters: row.input_schema,
    },
  }))
}

export function canonicalAcpTools(rows: readonly ContractRow[]) {
  return rows.map((row) => ({
    name: row.canonical_id,
    description: row.description,
    inputSchema: row.input_schema,
  }))
}

function errorResult(code: string, message: string): ToolCallResult {
  return {
    kind: 'error',
    error: { code, message: message.slice(0, 400) },
    message,
    text: message,
    byte_length: message.length,
    effect_state: 'not-started',
    retryable: false,
    provenance: {
      context_layer: 'transcript',
      context_role: 'assistant',
      context_property: 'tool-result',
    },
  }
}

function workspaceFor(sessionId: string) {
  const opts = { sessionId }
  return {
    async readFile(path: string): Promise<string | null> {
      try {
        return vfs.read(path, opts).text
      } catch (e) {
        if (e instanceof VfsError && e.code === 'path-not-found') return null
        throw e
      }
    },
    async writeFile(path: string, content: string) {
      const stat = vfs.write(path, content, opts)
      return {
        content_hash: stat.content_hash ?? '',
        size_bytes: stat.size_bytes ?? 0,
        mime: null,
        event_kind: 'file.write' as const,
        virtual_path: stat.path,
        tool_call_uuid: null,
      }
    },
    async writeFileBytes(path: string, content: Uint8Array) {
      const stat = vfs.write(path, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer, opts)
      return {
        content_hash: stat.content_hash ?? '',
        size_bytes: stat.size_bytes ?? 0,
        mime: null,
        event_kind: 'file.write' as const,
        virtual_path: stat.path,
        tool_call_uuid: null,
      }
    },
    async listDir(path: string) {
      const listed = vfs.list(path, opts)
      return listed.entries.map((entry) => ({ path: entry.path, size: entry.size_bytes ?? 0 }))
    },
    async deleteFile(path: string) {
      return vfs.remove(path, opts)
    },
    async statFile(path: string) {
      const stat = vfs.stat(path, opts)
      if (!stat.exists) return null
      return { size: stat.size_bytes ?? 0, mtime: stat.updated_ms ?? null }
    },
    async mkdir(path: string) {
      const resolved = vfs.stat(path, opts)
      if (!resolved.exists) {
        vfs.write(`${path.replace(/\/$/, '')}/.keep`, '', opts)
      }
      return { virtual_path: path, existed: resolved.exists }
    },
    async copyFile(sourcePath: string, destinationPath: string) {
      const text = vfs.read(sourcePath, opts).text
      vfs.write(destinationPath, text, opts)
    },
    async moveFile(sourcePath: string, destinationPath: string) {
      const text = vfs.read(sourcePath, opts).text
      vfs.write(destinationPath, text, opts)
      vfs.remove(sourcePath, opts)
    },
  }
}

interface SessionExec {
  registry: { has(name: string): boolean }
  executor: { execute(plan: unknown, ctx: unknown): Promise<{ result: ToolCallResult }> }
}

const sessions = new Map<string, SessionExec>()

export function bindBashSession(kernel: BashKernel, sessionId: string): SessionExec {
  const cached = sessions.get(sessionId)
  if (cached) return cached
  const registry = new kernel.InMemoryCapabilityRegistry()
  kernel.registerMinimalCommands(registry)
  const target = new kernel.LocalTsTarget()
  const workspace = workspaceFor(sessionId)
  const maps = [
    kernel.createFilesystemHandlers({ workspacePath: `/data/${sessionId}`, namespace: workspace }),
    kernel.createSearchHandlers({}),
    kernel.createFindHandlers({}),
    kernel.createTextProcessingHandlers(),
    kernel.createUtilHandlers(),
    kernel.createTeeHandlers(),
    kernel.createNetworkHandlers({
      fetchImpl: async (url: string, init?: unknown) => {
        const decision = egressDecision(url)
        if (!decision.ok) {
          const error = new Error(decision.reason) as Error & { code: string }
          error.code = decision.code
          throw error
        }
        return fetch(url, init as RequestInit)
      },
    }),
    kernel.createExecHandlers(),
    kernel.createVcsHandlers(),
    kernel.createTextOutputHandlers(),
    kernel.createTimeHandlers(),
    kernel.createWhichHandlers(),
    kernel.createStatHandlers({}),
    kernel.createTreeHandlers({}),
    kernel.createToolIntentHandlers(),
    kernel.createPipelineHandlers({ registry }),
  ]
  for (const group of maps) {
    for (const [name, handler] of group) target.registerHandler(name, handler)
  }
  const executor = new kernel.CapabilityExecutor(
    new Map([['local-ts', target]]),
    new kernel.CapabilityPolicyGate(registry),
    {
      timeoutMs: 30000,
      permissionAuthorizer: {
        async authorize(ctx) {
          const row = kernel.BASH_TOOL_CONTRACT_SOURCE.find((item) => item.canonical_id === ctx.plan.capabilityName) as {
            effect_class?: string
            approval_policy?: { mode?: 'allow' | 'ask' | 'deny' }
          } | undefined
          const verdict = decide('workspace-write', {
            name: ctx.plan.capabilityName,
            effect: row?.effect_class,
            approval: row?.approval_policy?.mode,
          })
          if (verdict === 'deny') return { verdict: 'deny', handlerCount: 1, reason: 'denied' }
          if (verdict === 'ask') return { verdict: 'deny', handlerCount: 1, reason: 'approval-pending' }
          return { verdict: 'allow', handlerCount: 1 }
        },
      },
    },
  )
  const bound = { registry, executor }
  sessions.set(sessionId, bound)
  return bound
}

export async function runCanonicalTool(kernel: BashKernel, sessionId: string, name: string, args: unknown): Promise<ToolCallResult> {
  try {
    const bound = bindBashSession(kernel, sessionId)
    const plan = kernel.planFromToolCall(name, args ?? {}, bound.registry)
    if (plan === null || plan === undefined) return errorResult('tool-not-registered', name)
    const out = await bound.executor.execute(plan, {
      workspace: workspaceFor(sessionId),
      sessionUuid: sessionId,
      workspaceUuid: sessionId,
      networkPolicyMode: 'restricted',
    })
    return out.result
  } catch (e) {
    if (e instanceof VfsError) return errorResult(e.code, e.message)
    if (e instanceof Error && (e as Error & { code?: string }).code === 'egress-denied') {
      return errorResult('egress-denied', e.message)
    }
    const message = e instanceof Error ? e.message : String(e)
    return errorResult('tool-call-failed', message)
  }
}

/** 测试换会话实现时丢掉缓存。 */
export function resetBashSessions(): void {
  sessions.clear()
}
