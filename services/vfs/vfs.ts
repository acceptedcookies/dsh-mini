/**
 * vfs —— 五根 VFS 门面（与 nano filesystem-core 同构，rules/filesystem.md §5）。
 * 写序：journal.begin → 对象字节（tmp→rename）→ storage 行 commit → journal.finish。
 * 崩溃中途留下的是无行引用的孤儿对象（可清扫），不是半真行。
 */
import { resolveVfsPath, assertWritable, sessionCwd, VfsError, type VfsLane } from './paths'
import { vfsStore, type VfsRow, type VfsPlacement } from './store'
import { localObjects, backendFor } from './objects'
import { vfsJournal } from './journal'
import { sha256Hex } from './sha256'
import { encodeUtf8, decodeUtf8 } from '../fx/utf8'

export interface VfsListEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size_bytes?: number
  content_hash?: string
  placement?: VfsPlacement
}

export interface VfsStat {
  path: string
  exists: boolean
  kind: 'file' | 'dir' | 'none'
  size_bytes?: number
  content_hash?: string
  object_version?: string
  placement?: VfsPlacement
  updated_ms?: number
}

export interface VfsReadResult {
  path: string
  text: string
  object_version: string
  size_bytes: number
  eof: boolean
  truncated: boolean
}

const MAX_READ = 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
}

export function guessMime(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return 'text/plain'
  return MIME_BY_EXT[path.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

function placementFor(lane: VfsLane): VfsPlacement {
  if (lane === 'scratch') return 'local-scratch'
  return 'local-hub'
}

function toBytes(content: string | ArrayBuffer): ArrayBuffer {
  if (typeof content === 'string') {
    const u8 = encodeUtf8(content)
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  }
  return content
}

/** 五根容器列举（`/`、`/data`、`/mnt`、`/backup` 的虚拟目录项）。 */
const FIXED_ROOTS = [
  { name: 'root', path: '/root' },
  { name: 'data', path: '/data' },
  { name: 'mnt', path: '/mnt' },
  { name: 'tmp', path: '/tmp' },
  { name: 'backup', path: '/backup' },
]

export const vfs = {
  cwd(sessionId: string): string {
    return sessionCwd(sessionId)
  },

  write(path: string, content: string | ArrayBuffer, opts: { sessionId: string; mime?: string }): VfsStat {
    const resolved = resolveVfsPath(path, opts.sessionId)
    assertWritable(resolved)
    if (resolved.lane === 'session' && resolved.laneKey !== opts.sessionId) {
      throw new VfsError('unsafe-workspace-path', `session lane 只允许写本会话 /data/${opts.sessionId}`)
    }
    const id = vfsJournal.begin(resolved.absolute, 'write')
    try {
      const bytes = toBytes(content)
      const hash = sha256Hex(new Uint8Array(bytes))
      const placement = placementFor(resolved.lane)
      backendFor(placement, vfsStore.getS3Config()).write(hash, bytes)
      const row: VfsRow = {
        virtual_path: resolved.absolute,
        object_key: hash,
        content_hash: `sha256:${hash}`,
        size_bytes: bytes.byteLength,
        mime: opts.mime ?? guessMime(resolved.absolute),
        placement,
        lane: resolved.lane,
        committed: true,
        updated_ms: Date.now(),
      }
      vfsStore.putRow(row)
      vfsJournal.finish(id)
      return this.stat(resolved.absolute, { sessionId: opts.sessionId })
    } catch (e) {
      vfsJournal.abandon(id)
      throw e
    }
  },

  read(path: string, opts: { sessionId: string; offset?: number; maxBytes?: number }): VfsReadResult {
    const resolved = resolveVfsPath(path, opts.sessionId)
    const row = vfsStore.getRow(resolved.absolute)
    if (row === undefined || !row.committed) throw new VfsError('path-not-found', `${resolved.absolute} 不存在`)
    const bytes = localObjects.read(row.object_key)
    const actual = sha256Hex(new Uint8Array(bytes))
    if (actual !== row.object_key) {
      throw new VfsError('hash-mismatch', `${resolved.absolute} content_hash 校验失败`)
    }
    const offset = Math.max(0, opts.offset ?? 0)
    const limit = Math.min(opts.maxBytes ?? MAX_READ, MAX_READ)
    const slice = bytes.slice(offset, Math.min(offset + limit, bytes.byteLength))
    return {
      path: resolved.absolute,
      text: decodeUtf8(new Uint8Array(slice)),
      object_version: row.content_hash,
      size_bytes: row.size_bytes,
      eof: offset + slice.byteLength >= bytes.byteLength,
      truncated: offset + slice.byteLength < bytes.byteLength,
    }
  },

  stat(path: string, opts: { sessionId: string }): VfsStat {
    const resolved = resolveVfsPath(path, opts.sessionId)
    if (resolved.absolute === '/') return { path: '/', exists: true, kind: 'dir' }
    const row = vfsStore.getRow(resolved.absolute)
    if (row !== undefined && row.committed) {
      return {
        path: resolved.absolute,
        exists: true,
        kind: 'file',
        size_bytes: row.size_bytes,
        content_hash: row.content_hash,
        object_version: row.content_hash,
        placement: row.placement,
        updated_ms: row.updated_ms,
      }
    }
    // 目录存在性：有任意子孙行即存在（隐式目录，无目录行）
    const under = vfsStore.rowsUnder(resolved.absolute)
    const isFixedRoot = FIXED_ROOTS.some((r) => r.path === resolved.absolute)
    if (under.length > 0 || isFixedRoot) return { path: resolved.absolute, exists: true, kind: 'dir' }
    return { path: resolved.absolute, exists: false, kind: 'none' }
  },

  /** 列举投影：`/` 恒列五根；`/data` 列 session 桶；`/mnt`/`/backup` 首版为空注册表。 */
  list(path: string, opts: { sessionId: string; cursor?: string; limit?: number }): { entries: VfsListEntry[]; nextCursor: string | null } {
    const resolved = resolveVfsPath(path, opts.sessionId)
    const limit = Math.min(opts.limit ?? 200, 500)
    let entries: VfsListEntry[] = []
    if (resolved.absolute === '/') {
      entries = FIXED_ROOTS.map((r): VfsListEntry => ({ name: r.name, path: r.path, kind: 'dir' }))
    } else if (resolved.lane === 'mount' || resolved.lane === 'backup') {
      // 挂载名/副本名注册表：首版为空（rules/filesystem.md §5 占位留缝）
      if (resolved.laneKey !== undefined) throw new VfsError('path-not-found', `${resolved.absolute} 无挂载`)
    } else {
      const prefix = `${resolved.absolute}/`
      const seen = new Map<string, VfsListEntry>()
      for (const row of vfsStore.rowsUnder(resolved.absolute)) {
        const rest = row.virtual_path.slice(prefix.length)
        if (rest.length === 0) continue
        const slash = rest.indexOf('/')
        if (slash === -1) {
          seen.set(rest, {
            name: rest,
            path: row.virtual_path,
            kind: 'file',
            size_bytes: row.size_bytes,
            content_hash: row.content_hash,
            placement: row.placement,
          })
        } else {
          const dir = rest.slice(0, slash)
          if (!seen.has(dir)) seen.set(dir, { name: dir, path: `${prefix}${dir}`, kind: 'dir' })
        }
      }
      entries = [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
      if (entries.length === 0 && this.stat(resolved.absolute, opts).kind === 'none') {
        throw new VfsError('path-not-found', `${resolved.absolute} 不存在`)
      }
    }
    const start = opts.cursor !== undefined ? Number.parseInt(opts.cursor, 10) || 0 : 0
    const page = entries.slice(start, start + limit)
    const next = start + limit < entries.length ? String(start + limit) : null
    return { entries: page, nextCursor: next }
  },

  remove(path: string, opts: { sessionId: string }): boolean {
    const resolved = resolveVfsPath(path, opts.sessionId)
    assertWritable(resolved)
    const id = vfsJournal.begin(resolved.absolute, 'remove')
    try {
      const row = vfsStore.removeRow(resolved.absolute)
      vfsJournal.finish(id)
      return row !== undefined // 对象字节按无引用惰性清扫，不即时删（同 nano 对象层惰性）
    } catch (e) {
      vfsJournal.abandon(id)
      throw e
    }
  },

  /** 上传入口：本地临时路径（chooseMedia/chooseMessageFile/测试写入）→ VFS 行+对象。 */
  ingestLocal(localPath: string, vfsPath: string, opts: { sessionId: string; mime?: string }): VfsStat {
    let bytes: ArrayBuffer
    try {
      // 同 objects.ts：无编码读返回的 Buffer 在此环境不可直接用——base64 通道。
      const b64 = wx.getFileSystemManager().readFileSync(localPath, 'base64') as string
      bytes = wx.base64ToArrayBuffer(b64)
    } catch {
      throw new VfsError('path-not-found', `本地文件 ${localPath} 不可读`)
    }
    // write 自记 journal（op=write 覆盖 ingest 语义，单写者下足够）
    return this.write(vfsPath, bytes, { sessionId: opts.sessionId, mime: opts.mime ?? guessMime(localPath) })
  },
}
