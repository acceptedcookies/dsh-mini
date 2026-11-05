/**
 * remote-sync —— VFS 行/对象 → POD1 fss3 的写穿镜像（MN02 §0.2.3）。
 *
 * 远端命名（`vfs/` 键区内，oid 服务端注入）：
 *   objects/{sha256}                       对象字节（content-addressed，天然幂等/去重）
 *   rows/{path 去前导斜杠}                  VfsRow JSON（行真源投影；updated_ms 较大者赢）
 *   workspaces/{name}.json                 workspace 清单 {kind,sessions[]}
 *   workspaces/{name}/sessions/{sid}.json  session 挂载行
 *
 * 本地投影：/mnt 挂载注册表（vfsStore.mounts）+ `dsh:vfs:v1:sync` 指针图
 * {path→{etag,synced_ms}}——指针是消费回执不是真源（远端行为真源）。
 *
 * 诚实语义：placement 'local-scratch'（/tmp）不镜像——scratch 本义即非 durable；
 * USER_DATA_PATH 是 cache-tier，远端才是 cloud 语义下的字节真源。
 */
import { vfsStore, type MountRow, type VfsRow } from './store'
import { localObjects } from './objects'
import { VfsError } from './paths'
import { encodeUtf8, decodeUtf8 } from '../fx/utf8'
import type { RemoteVfs } from './remote'

const SYNC_KEY = 'dsh:vfs:v1:sync'

interface SyncPointer {
  etag: string
  synced_ms: number
}

function pointers(): Record<string, SyncPointer> {
  const v = wx.getStorageSync(SYNC_KEY) as Record<string, SyncPointer> | '' | undefined
  return v !== '' && v !== undefined ? v : {}
}

function writePointers(map: Record<string, SyncPointer>): void {
  wx.setStorageSync(SYNC_KEY, map)
}

/** path ↔ 远端行键：`/data/s1/a.txt` → `rows/data/s1/a.txt`。 */
const rowKey = (path: string): string => `rows/${path.replace(/^\//, '')}`
const rowPath = (key: string): string | null =>
  key.startsWith('rows/') ? `/${key.slice('rows/'.length)}` : null

const sanitizeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, '-')
const wsKey = (name: string): string => `workspaces/${sanitizeName(name)}.json`
const mountKey = (ws: string, sid: string): string => `workspaces/${sanitizeName(ws)}/sessions/${sanitizeName(sid)}.json`

const enc = (s: string): ArrayBuffer => {
  const u8 = encodeUtf8(s)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}
const dec = (b: ArrayBuffer): string => decodeUtf8(new Uint8Array(b))

export interface SyncReport {
  pushed: string[]
  skipped: string[]
  failed: Array<{ path: string; error: string }>
}

export function createVfsSync(remote: RemoteVfs) {
  /** 已同步（指针在图）的路径集；UI/诊断用。 */
  const syncedMap = (): Record<string, SyncPointer> => pointers()

  /** 单路径推送：对象字节（幂等）→ 行 JSON。返回远端 etag。 */
  async function pushPath(path: string): Promise<string> {
    const row = vfsStore.getRow(path)
    if (row === undefined || !row.committed) throw new VfsError('path-not-found', `push: ${path} 无已提交行`)
    const bytes = localObjects.read(row.object_key)
    await remote.put(`objects/${row.object_key}`, bytes, { mime: row.mime, ifNoneMatch: true }).catch((e) => {
      // if-none-match 412 = 同 hash 已存（content-addressed 幂等）——非失败
      if (e instanceof VfsError && e.code === 'fence-blocked') return undefined
      throw e
    })
    const r = await remote.put(rowKey(path), enc(JSON.stringify(row)), { mime: 'application/json' })
    const map = pointers()
    map[path] = { etag: r.etag, synced_ms: row.updated_ms }
    writePointers(map)
    return r.etag
  }

  /** 全量推送 durable lane 行（placement≠local-scratch）；未变行按指针跳过。 */
  async function pushAll(): Promise<SyncReport> {
    const report: SyncReport = { pushed: [], skipped: [], failed: [] }
    const map = pointers()
    for (const row of vfsStore.allRows()) {
      if (row.placement === 'local-scratch') continue
      if (!row.committed) continue
      const p = map[row.virtual_path]
      if (p !== undefined && p.synced_ms >= row.updated_ms) {
        report.skipped.push(row.virtual_path)
        continue
      }
      try {
        await pushPath(row.virtual_path)
        report.pushed.push(row.virtual_path)
      } catch (e) {
        report.failed.push({ path: row.virtual_path, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return report
  }

  /** 行删除传播：远端行键删除；对象字节按无引用惰性保留（与本地对象层同语义）。 */
  async function pushRemove(path: string): Promise<void> {
    await remote.del(rowKey(path))
    const map = pointers()
    delete map[path]
    writePointers(map)
  }

  /** 下拉行面：远端 rows/* → 本地行 upsert（updated_ms 较大者赢）。返回新拉行路径。 */
  async function pullRows(): Promise<string[]> {
    const keys = await remote.list('rows/', 1000)
    const pulled: string[] = []
    const map = pointers()
    for (const key of keys) {
      const path = rowPath(key)
      if (path === null) continue
      const local = vfsStore.getRow(path)
      const r = await remote.get(key)
      if (r === null) continue
      let row: VfsRow
      try {
        row = JSON.parse(dec(r.bytes)) as VfsRow
      } catch {
        continue
      }
      if (local !== undefined && local.updated_ms >= row.updated_ms) continue
      vfsStore.putRow(row)
      map[path] = { etag: r.etag, synced_ms: row.updated_ms }
      pulled.push(path)
    }
    writePointers(map)
    return pulled
  }

  /** 按需取回对象字节：行在而本地字节缺失（cache-tier 被清）→ 远端拉回补 cache。 */
  async function hydrate(path: string): Promise<boolean> {
    const row = vfsStore.getRow(path)
    if (row === undefined) return false
    if (localObjects.exists(row.object_key)) return true
    const r = await remote.get(`objects/${row.object_key}`)
    if (r === null) return false
    localObjects.write(row.object_key, r.bytes)
    return true
  }

  /** workspace 建立：远端清单 + 本地 /mnt 挂载投影。 */
  async function createWorkspace(name: string): Promise<MountRow> {
    const safe = sanitizeName(name)
    const manifest = { kind: 'workspace', name: safe, sessions: [], created_ms: Date.now() }
    await remote.put(wsKey(safe), enc(JSON.stringify(manifest)), { mime: 'application/json' })
    const mount: MountRow = { name: safe, workspace: safe, sessions: [], created_ms: manifest.created_ms }
    vfsStore.putMount(mount)
    return mount
  }

  /** session 挂载：挂载行 + workspace 清单 sessions[] 追加 + 本地投影更新。 */
  async function mountSession(workspace: string, sessionId: string): Promise<MountRow> {
    const safe = sanitizeName(workspace)
    let mount = vfsStore.getMount(safe)
    if (mount === undefined) {
      // 远端已有 workspace（换机/重装投影丢失）→ 以远端为准复活本地投影
      const r = await remote.get(wsKey(safe))
      const remoteSessions = r === null ? [] : ((JSON.parse(dec(r.bytes)) as { sessions?: string[] }).sessions ?? [])
      mount = { name: safe, workspace: safe, sessions: remoteSessions, created_ms: Date.now() }
    }
    if (!mount.sessions.includes(sessionId)) {
      mount = { ...mount, sessions: [...mount.sessions, sessionId] }
    }
    await remote.put(mountKey(safe, sessionId), enc(JSON.stringify({ kind: 'session-mount', workspace: safe, session_id: sessionId, mounted_ms: Date.now() })), { mime: 'application/json' })
    await remote.put(wsKey(safe), enc(JSON.stringify({ kind: 'workspace', name: safe, sessions: mount.sessions, created_ms: mount.created_ms })), { mime: 'application/json' })
    vfsStore.putMount(mount)
    return mount
  }

  /** 远端 workspace 清单 → 本地 /mnt 投影重建（返回 workspace 名列表）。 */
  async function pullWorkspaces(): Promise<string[]> {
    const keys = await remote.list('workspaces/', 500)
    const names: string[] = []
    for (const key of keys) {
      const m = key.match(/^workspaces\/([^/]+)\.json$/)
      if (m === null) continue
      const r = await remote.get(key)
      if (r === null) continue
      try {
        const w = JSON.parse(dec(r.bytes)) as { name: string; sessions?: string[]; created_ms?: number }
        vfsStore.putMount({ name: w.name, workspace: w.name, sessions: w.sessions ?? [], created_ms: w.created_ms ?? Date.now() })
        names.push(w.name)
      } catch {
        /* 坏行跳过 */
      }
    }
    return names
  }

  return { syncedMap, pushPath, pushAll, pushRemove, pullRows, hydrate, createWorkspace, mountSession, pullWorkspaces }
}

export type VfsSync = ReturnType<typeof createVfsSync>
