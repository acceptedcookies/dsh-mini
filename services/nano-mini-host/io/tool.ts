/**
 * io.tool mp 侧实现：调 tool-surface 共享层，把 ToolSurfaceResult 包装为
 * kernel ToolCallResult（inline-text + provenance，kernel-do.mjs:13-20 形状）。
 * provenance 缺省会触发 kernel tool-result-provenance-missing（EM-N 已踩）——必带。
 */

import { runFileTool } from '../../vfs/tool-surface'
import type { ToolCallResult } from '../types'

const enc = (s: string): number => {
  // byteLength：mp JSC 无 TextEncoder 时由 shims 挂入；这里走简单 utf8 计数避免依赖面
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xd800 || c > 0xdbff ? 3 : (i += 1, 4)
  }
  return n
}

export function createIoTool(dshSessionId: string) {
  return async (name: string, args: unknown): Promise<ToolCallResult> => {
    const r = runFileTool(name, args, dshSessionId)
    const filePath = (args as Record<string, unknown> | null)?.path
    if (r.isError) {
      return {
        kind: 'error',
        message: r.content,
        text: r.content,
        byte_length: enc(r.content),
        provenance: {
          context_layer: 'transcript',
          context_role: 'assistant',
          context_property: 'tool-result',
        },
      }
    }
    return {
      kind: 'inline-text',
      text: r.content,
      byte_length: enc(r.content),
      provenance: {
        context_layer: name === 'file_read' ? 'file_read' : 'transcript',
        context_role: 'assistant',
        context_property: 'tool-result',
        ...(typeof filePath === 'string' && filePath.length > 0 ? { file_path: filePath } : {}),
      },
    }
  }
}
