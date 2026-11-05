/**
 * file_* 工具共享层（T-O-4 tool 合约同源 / T-O-8）。
 * 从 services/fx/runtime.ts executeFileTool 机械抽取 —— fx dispatchTool 与
 * nano-mini host io.tool 调用同一实现源。dsh session 即 VFS session 作用域
 * （cwd=/data/{dshSessionId}）。
 */

import { vfs } from './vfs'
import { VfsError } from './paths'
import { storage } from '../storage'

export interface ToolSurfaceResult {
  content: string
  isError: boolean
}

/** 权限面在工具边界生效（UI 审查 F1）：「仅可查看」档拒写/删——此前权限
 *  chip 只读 storage 不作用任何执行面，纯装饰=安全剧场。写/删工具是唯一
 *  可变面，读/list/stat 不受限；其余档位（workspace-write/danger/auto）当前
 *  等价放行——VFS 即全部可达文件面，无越区/审批通道存在（如实等价非剧场）。 */
const WRITE_TOOLS = new Set(['file_write', 'file_remove'])

export function runFileTool(name: string, input: unknown, dshSessionId: string): ToolSurfaceResult {
  if (storage.getPermission() === 'read-only' && WRITE_TOOLS.has(name)) {
    return {
      content: JSON.stringify({ error: 'permission-denied', message: '当前权限为「仅可查看」——写入/删除被拒，请在权限菜单切换后可写' }),
      isError: true,
    }
  }
  const args = (input ?? {}) as Record<string, unknown>
  const path = typeof args.path === 'string' ? args.path : ''
  try {
    switch (name) {
      case 'file_read': {
        const r = vfs.read(path, {
          sessionId: dshSessionId,
          offset: typeof args.offset === 'number' ? args.offset : undefined,
          maxBytes: typeof args.max_bytes === 'number' ? args.max_bytes : undefined,
        })
        return {
          content: JSON.stringify({ path: r.path, text: r.text, object_version: r.object_version, size_bytes: r.size_bytes, eof: r.eof, truncated: r.truncated }),
          isError: false,
        }
      }
      case 'file_write': {
        const s = vfs.write(path, typeof args.content === 'string' ? args.content : '', { sessionId: dshSessionId })
        return { content: JSON.stringify(s), isError: false }
      }
      case 'file_list': {
        const r = vfs.list(path, {
          sessionId: dshSessionId,
          cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        })
        return { content: JSON.stringify(r), isError: false }
      }
      case 'file_stat':
        return { content: JSON.stringify(vfs.stat(path, { sessionId: dshSessionId })), isError: false }
      case 'file_remove':
        return { content: JSON.stringify({ removed: vfs.remove(path, { sessionId: dshSessionId }) }), isError: false }
      default:
        return { content: `unknown file tool ${name}`, isError: true }
    }
  } catch (e) {
    const code = e instanceof VfsError ? e.code : 'error'
    return { content: JSON.stringify({ error: code, message: e instanceof Error ? e.message : String(e) }), isError: true }
  }
}
