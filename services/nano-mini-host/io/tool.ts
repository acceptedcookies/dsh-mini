/**
 * io.tool：模型工具名进 bash-core executor，fs 只调 vfs。
 * 没有 file_* 分发。
 */

import { loadKernel } from '../kernel-loader'
import type { ToolCallResult } from '../types'
import { isBashKernel, runCanonicalTool } from './bash-exec'

export function createIoTool(dshSessionId: string) {
  return async (name: string, args: unknown): Promise<ToolCallResult> => {
    const kernel = loadKernel()
    if (!isBashKernel(kernel)) {
      return {
        kind: 'error',
        error: { code: 'tool-call-failed', message: 'kernel tool surface unavailable' },
        message: 'kernel tool surface unavailable',
        text: 'kernel tool surface unavailable',
        effect_state: 'not-started',
        retryable: false,
        provenance: {
          context_layer: 'transcript',
          context_role: 'assistant',
          context_property: 'tool-result',
        },
      }
    }
    return runCanonicalTool(kernel, dshSessionId, name, args)
  }
}
