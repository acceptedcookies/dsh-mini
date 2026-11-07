/**
 * vfs —— 五根 VFS 门面（与 nano filesystem-core 同构，rules/filesystem.md §5）。
 * 写序：journal.begin → 对象字节（tmp→rename）→ storage 行 commit → journal.finish。
 * 崩溃中途留下的是无行引用的孤儿对象（可清扫），不是半真行。
 */
import { resolveVfsPath, assertWritable, sessionCwd, VfsError, type VfsLane } from './paths'
import { vfsStore, type VfsRow, type VfsPlacement } from './store'
import { localObjects, backendFor } from './objects'
import { vfsJournal } from './journal'
import { beginDelete, commitDelete, abortDelete } from './tombstone'
import { sha256Hex } from './sha256'
import { encodeUtf8, decodeUtf8 } from '../fx/utf8'
import { reportSilent } from '../error-report'

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

// ── 远端镜像钩子（MN02 §0.2.3）：写/删成功后通知 remote-sync 推送；
//    scratch lane 不镜像（local-scratch 本义即非 durable）。由 app.ts 在
//    cloud 车道绑定时挂接——vfs 层不知道远端存在（单向依赖不回头）。
type MirrorHook = (path: string, kind: 'write' | 'remove') => void
let mirrorHook: MirrorHook | undefined
export function setVfsMirrorHook(fn: MirrorHook | undefined): void {
  mirrorHook = fn
}

/** 镜像 lane 判定（app.ts 注入：magpie 会话行是纯本地车道）。
 *  scratch 由 vfs 层静态排除；未注入时默认镜像（Node 测试/无 app 上下文）。 */
type MirrorPredicate = (path: string) => boolean
let mirrorPredicate: MirrorPredicate | undefined
export function setVfsMirrorPredicate(fn: MirrorPredicate | undefined): void {
  mirrorPredicate = fn
}
const mirrored = (path: string, lane: VfsLane): boolean =>
  lane !== 'scratch' && (mirrorPredicate === undefined || mirrorPredicate(path))

/** `/mnt/{ws}/{sid}/{sub}` read-through 投影 → `/data/{sid}/{sub}`；
 *  `/mnt/{ws}/{sid}` → `/data/{sid}`；未挂载/形状不符 → null。 */
function mountProjection(absolute: string): string | null {
  const segs = absolute.split('/')
  if (segs[1] !== 'mnt' || segs.length < 4 || segs[3] === undefined) return null
  const mount = vfsStore.getMount(segs[2])
  if (mount === undefined || !mount.sessions.includes(segs[3])) return null
  return `/data/${segs[3]}${segs.length > 4 ? `/${segs.slice(4).join('/')}` : ''}`
}

/** 普通 lane 的一级列举（seen-map 去重：文件/隐式目录）。
 *  displayPrefix 非空时 entry.path 以展示前缀回放（mount 投影面）。 */
function listRowsUnder(absolute: string, displayPrefix?: string): VfsListEntry[] {
  const prefix = `${absolute}/`
  const display = (p: string): string => displayPrefix !== undefined ? p.replace(absolute, displayPrefix) : p
  const seen = new Map<string, VfsListEntry>()
  for (const row of vfsStore.rowsUnder(absolute)) {
    const rest = row.virtual_path.slice(prefix.length)
    if (rest.length === 0) continue
    const slash = rest.indexOf('/')
    if (slash === -1) {
      seen.set(rest, {
        name: rest,
        path: display(row.virtual_path),
        kind: 'file',
        size_bytes: row.size_bytes,
        content_hash: row.content_hash,
        placement: row.placement,
      })
    } else {
      const dir = rest.slice(0, slash)
      if (!seen.has(dir)) seen.set(dir, { name: dir, path: display(`${prefix}${dir}`), kind: 'dir' })
    }
  }
  return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
}

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
      if (resolved.lane !== 'scratch') mirrorHook?.(resolved.absolute, 'write')
      return this.stat(resolved.absolute, { sessionId: opts.sessionId })
    } catch (e) {
      vfsJournal.abandon(id)
      throw e
    }
  },

  read(path: string, opts: { sessionId: string; offset?: number; maxBytes?: number }): VfsReadResult {
    const resolved = resolveVfsPath(path, opts.sessionId)
    // mount lane read-through：/mnt/{ws}/{sid}/{sub} → /data/{sid}/{sub} 行
    const rowPath = resolved.lane === 'mount' ? mountProjection(resolved.absolute) : resolved.absolute
    const row = rowPath === null ? undefined : vfsStore.getRow(rowPath)
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
    // /mnt 挂载注册表：/mnt/{name} 存在当挂载行在册；/mnt/{name}/{sid} 存在当 session 已挂；
    // 更深层 read-through 到 /data/{sid}/{sub}（行=file、子孙=dir、无=none——不再幻影 dir）。
    if (resolved.lane === 'mount' && resolved.laneKey !== undefined) {
      const mount = vfsStore.getMount(resolved.laneKey)
      if (mount === undefined) return { path: resolved.absolute, exists: false, kind: 'none' }
      const proj = mountProjection(resolved.absolute)
      if (proj !== null) {
        if (proj === `/data/${resolved.absolute.split('/')[3]}`) return { path: resolved.absolute, exists: true, kind: 'dir' }
        const prow = vfsStore.getRow(proj)
        if (prow !== undefined && prow.committed) {
          return {
            path: resolved.absolute, exists: true, kind: 'file',
            size_bytes: prow.size_bytes, content_hash: prow.content_hash,
            object_version: prow.content_hash, placement: prow.placement, updated_ms: prow.updated_ms,
          }
        }
        if (vfsStore.rowsUnder(proj).length > 0) return { path: resolved.absolute, exists: true, kind: 'dir' }
        return { path: resolved.absolute, exists: false, kind: 'none' }
      }
      const third = resolved.absolute.split('/')[3]
      if (third === undefined) return { path: resolved.absolute, exists: true, kind: 'dir' }
    }
    return { path: resolved.absolute, exists: false, kind: 'none' }
  },

  /** 列举投影：`/` 恒列五根；`/data` 列 session 桶；`/mnt`/`/backup` 首版为空注册表。 */
  list(path: string, opts: { sessionId: string; cursor?: string; limit?: number }): { entries: VfsListEntry[]; nextCursor: string | null } {
    const resolved = resolveVfsPath(path, opts.sessionId)
    const limit = Math.min(opts.limit ?? 200, 500)
    let entries: VfsListEntry[] = []
    if (resolved.absolute === '/') {
      entries = FIXED_ROOTS.map((r): VfsListEntry => ({ name: r.name, path: r.path, kind: 'dir' }))
    } else if (resolved.lane === 'mount') {
      // 挂载注册表：/mnt 列 workspace 挂载名；/mnt/{ws} 列已挂 session；
      // /mnt/{ws}/{sid}/{sub} read-through 列 /data/{sid}/{sub}（幻影重列已修——审查 B8）
      if (resolved.laneKey === undefined) {
        entries = vfsStore.allMounts()
          .map((m): VfsListEntry => ({ name: m.name, path: `/mnt/${m.name}`, kind: 'dir' }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))
      } else {
        const mount = vfsStore.getMount(resolved.laneKey)
        if (mount === undefined) throw new VfsError('path-not-found', `${resolved.absolute} 无挂载`)
        const proj = mountProjection(resolved.absolute)
        if (proj === null) {
          const third = resolved.absolute.split('/')[3]
          if (third === undefined) {
            entries = mount.sessions.map((sid): VfsListEntry => ({ name: sid, path: `/mnt/${mount.name}/${sid}`, kind: 'dir' }))
          } else {
            throw new VfsError('path-not-found', `${resolved.absolute} 未挂载该 session`)
          }
        } else {
          entries = listRowsUnder(proj, resolved.absolute)
          if (entries.length === 0 && proj !== `/data/${resolved.absolute.split('/')[3]}`) {
            throw new VfsError('path-not-found', `${resolved.absolute} 不存在`)
          }
        }
      }
    } else if (resolved.lane === 'backup') {
      // 副本名注册表：首版为空（rules/filesystem.md §5 占位留缝）
      if (resolved.laneKey !== undefined) throw new VfsError('path-not-found', `${resolved.absolute} 无副本`)
    } else {
      entries = listRowsUnder(resolved.absolute)
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
    if (resolved.lane === 'session' && resolved.laneKey !== opts.sessionId) {
      throw new VfsError('unsafe-workspace-path', `session lane 只允许删本会话 /data/${opts.sessionId}`)
    }
    const id = vfsJournal.begin(resolved.absolute, 'remove')
    const mirror = mirrored(resolved.absolute, resolved.lane)

    // 删除意图必须先于 removeRow 落盘，且不经 app.ts 的 ticket 门控（T-O-2/T-O-7）。
    if (mirror) {
      try {
        beginDelete(resolved.absolute)
      } catch (e) {
        vfsJournal.abandon(id)
        reportSilent(e, { op: 'vfs-tomb-begin', lane: 'background', path: resolved.absolute })
        throw e
      }
    }

    let row: VfsRow | undefined
    try {
      row = vfsStore.removeRow(resolved.absolute)
    } catch (e) {
      if (mirror) {
        try { abortDelete(resolved.absolute) } catch (e2) {
          reportSilent(e2, { op: 'vfs-tomb-abort', lane: 'background', path: resolved.absolute })
        }
      }
      vfsJournal.abandon(id)
      throw e
    }

    // 本地删除已成功：commit 失败保留 pending 碑（recover 下次补齐），不回滚已删 row。
    if (mirror) {
      try { commitDelete(resolved.absolute) } catch (e) {
        reportSilent(e, { op: 'vfs-tomb-commit', lane: 'background', path: resolved.absolute })
      }
    }
    vfsJournal.finish(id)

    // 事务外：hook 失败不得回滚已提交删除意图（commit 后 abort 会复活删除项）。
    if (row !== undefined && mirror) {
      try { mirrorHook?.(resolved.absolute, 'remove') } catch (e) {
        reportSilent(e, { op: 'vfs-mirror-hook', lane: 'background', path: resolved.absolute })
      }
    }
    return row !== undefined // 对象字节按无引用惰性清扫，不即时删（同 nano 对象层惰性）
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
