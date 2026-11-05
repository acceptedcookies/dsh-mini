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
import { sha256Hex } from './sha256'
import { encodeUtf8, decodeUtf8 } from '../fx/utf8'
import { reportSilent } from '../error-report'
import type { RemoteVfs } from './remote'

const SYNC_KEY = 'dsh:vfs:v1:sync'
/** 删除墓碑（客户端侧，不占远端键区——不扩约）：path→deleted_ms。
 *  pushRemove 失败（网络抖动）后，pullRows 见远端行不复活本删项，并重发删除收敛；
 *  远端行 updated_ms 更新于墓碑=真重建（LWW），复活并清碑（审查四轮 F3）。 */
const TOMB_KEY = 'dsh:mini:vfs-tombstones'

function tombstones(): Record<string, number> {
  const v = wx.getStorageSync(TOMB_KEY) as Record<string, number> | '' | undefined
  return v !== '' && v !== undefined ? v : {}
}

/** 每次新删除意图都刷新碑时——唯一调用方是 pushRemove（heal 走 remote.del 不经此），
 *  「删除→远端跨设备重建→用户再删→del 再失败」链下滞留旧碑会把新删项错判成真
 *  重建复活（审查六轮）。无界增长防（审查五轮）：满 512 逐最旧。 */
const TOMB_CAP = 512
function setTomb(path: string): void {
  const t = tombstones()
  t[path] = Date.now()
  const keys = Object.keys(t)
  if (keys.length > TOMB_CAP) {
    keys.sort((a, b) => (t[a] ?? 0) - (t[b] ?? 0))
    for (const k of keys.slice(0, keys.length - TOMB_CAP)) delete t[k]
  }
  wx.setStorageSync(TOMB_KEY, t)
}

function clearTomb(path: string): void {
  const t = tombstones()
  if (t[path] !== undefined) {
    delete t[path]
    wx.setStorageSync(TOMB_KEY, t)
  }
}

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
    let bytes: ArrayBuffer
    try {
      bytes = localObjects.read(row.object_key)
    } catch {
      // 行在字节失（cache 清理/重装）→ 先从远端对象回源补齐再推——
      // 远端有行时 push 不该 bytes-missing 死锁（审查三轮 N4）。
      if (!(await hydrate(path))) throw new VfsError('bytes-missing', `push: ${path} 本地字节缺失且远端无对象`)
      bytes = localObjects.read(row.object_key)
    }
    await remote.put(`objects/${row.object_key}`, bytes, { mime: row.mime, ifNoneMatch: true }).catch((e) => {
      // if-none-match 412 = 同 hash 已存（content-addressed 幂等）——非失败；
      // 鸭子类型查 code 不用 instanceof（跨 bundle 打包实例不恒等——审查 B8 实证）。
      if ((e as { code?: string }).code === 'fence-blocked') return undefined
      throw e
    })
    const r = await remote.put(rowKey(path), enc(JSON.stringify(row)), { mime: 'application/json' })
    const map = pointers()
    map[path] = { etag: r.etag, synced_ms: row.updated_ms }
    writePointers(map)
    clearTomb(path) // 本地新写胜出——删碑让位（LWW：内容新于删除意图）
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

  /** 行删除传播：远端行键删除；对象字节按无引用惰性保留（与本地对象层同语义）。
   *  墓碑先落——远端 del 失败时删除意图仍 durable，pullRows 不复活+重删收敛（F3）。 */
  async function pushRemove(path: string): Promise<void> {
    try {
      setTomb(path)
    } catch (e) {
      // 碑写入自身可抛（storage 配额）——删除意图不因此丢失：远端 del 照常，
      // 远端 del 成功即收敛；仅「碑缺席+远端 del 也失败」留复活面（如实 warn，审查五轮）。
      console.warn(`[remote-sync] setTomb 失败 ${path}（复活防护缺席）:`, e instanceof Error ? e.message : e)
      reportSilent(e, { op: 'vfs-tomb', lane: 'background', path })
    }
    await remote.del(rowKey(path))
    // 远端已删=删除意图落地——碑使命完成即清，否则每删一碑永久积压（审查五轮）。
    clearTomb(path)
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
      if (r === null) {
        // 远端已缺席——若有碑其意图已落地，清碑防积压（审查五轮）。
        if (tombstones()[path] !== undefined) clearTomb(path)
        continue
      }
      let row: VfsRow
      try {
        row = JSON.parse(dec(r.bytes)) as VfsRow
      } catch (e) {
        // 坏行如实 warn——静默跳过会让毒化行永远缺席且无面可查（审查 B8）。
        console.warn(`[remote-sync] pullRows 跳过坏行 ${key}`)
        reportSilent(e, { op: 'vfs-pull-rows', lane: 'background', key })
        continue
      }
      const tomb = tombstones()[path]
      if (local === undefined && tomb !== undefined) {
        if (row.updated_ms <= tomb) {
          // 本删项远端行残存（pushRemove 曾失败）——不复活，重发删除收敛（F3）；
          // 重删成功即清碑（使命完成），失败留碑下轮重试（审查五轮）。
          void remote.del(key)
            .then(() => clearTomb(path))
            .catch((e) => { console.warn(`[remote-sync] 墓碑重删失败 ${key}:`, e instanceof Error ? e.message : e); reportSilent(e, { op: 'vfs-tomb-redel', lane: 'background', key }) })
          continue
        }
        clearTomb(path) // 远端行新于墓碑=真重建，LWW 复活
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
    // 内容寻址面自验：远端字节与 object_key 不符不得写 cache——
    // 否则坏字节永久驻留正确键下，vfs.read 恒 hash-mismatch（审查 B8）。
    if (sha256Hex(new Uint8Array(r.bytes)) !== row.object_key) {
      console.warn(`[remote-sync] hydrate 字节 hash 与 object_key 不符 ${path}`)
      reportSilent(new Error('hash-mismatch: hydrate 远端字节与 object_key 不符'), { op: 'vfs-hydrate', lane: 'background', path })
      return false
    }
    localObjects.write(row.object_key, r.bytes)
    return true
  }

  /** 自愈面：本地行在而对象字节缺失（cache 清理）→ 全量回源补齐——
   *  缺口不只在当轮 pulled 集内，pullRows 按 updated_ms 跳过的行同样可能缺字节（审查三轮 N4）。 */
  async function hydrateMissing(): Promise<string[]> {
    const healed: string[] = []
    for (const row of vfsStore.allRows()) {
      if (row.placement === 'local-scratch' || !row.committed) continue
      if (localObjects.exists(row.object_key)) continue
      if (await hydrate(row.virtual_path)) healed.push(row.virtual_path)
    }
    return healed
  }

  /** workspace 清单 etag 条件写（多设备挂载并发防丢条目）：读→合并→ifMatch 写，
   *  409 冲突重读重试一次；仍冲突如实抛（对手持有中，调用方下一轮 reconcile 自愈）。 */
  async function putManifestCas(safe: string, mutate: (w: { kind: string; name: string; sessions: string[]; created_ms: number }) => void): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cur = await remote.get(wsKey(safe))
      let manifest: { kind: string; name: string; sessions: string[]; created_ms: number }
      if (cur !== null) {
        try {
          manifest = JSON.parse(dec(cur.bytes)) as typeof manifest
        } catch (e) {
          // 坏清单如实 warn——静默重置 sessions:[] 会在下次写时吞掉对手挂载条目（审查三轮）。
          console.warn(`[remote-sync] workspace ${safe} 清单坏行——按空清单合并`)
          reportSilent(e, { op: 'vfs-manifest', lane: 'background', workspace: safe })
          manifest = { kind: 'workspace', name: safe, sessions: [], created_ms: Date.now() }
        }
      } else {
        manifest = { kind: 'workspace', name: safe, sessions: [], created_ms: Date.now() }
      }
      mutate(manifest)
      // cur===null 时必须 ifNoneMatch 而非无条件写——双设备并发建同 workspace
      // 都读到 null 都直写会丢条目（正是本 CAS 环要防的竞态，审查 B8）。
      const r = await remote.put(wsKey(safe), enc(JSON.stringify(manifest)), {
        mime: 'application/json',
        ifMatch: cur?.etag,
        ifNoneMatch: cur === null,
      }).then(() => true).catch((e) => {
        if ((e as { code?: string }).code === 'fence-blocked') return false
        throw e
      })
      if (r) return
    }
    throw new VfsError('fence-blocked', `workspace ${safe} 清单写冲突（重试耗尽）`)
  }

  /** workspace 建立：远端清单 + 本地 /mnt 挂载投影。 */
  async function createWorkspace(name: string): Promise<MountRow> {
    const safe = sanitizeName(name)
    await putManifestCas(safe, () => { /* 存在即幂等——sessions 保留对手已挂条目 */ })
    const existing = vfsStore.getMount(safe) ?? { name: safe, workspace: safe, sessions: [], created_ms: Date.now() }
    vfsStore.putMount(existing)
    return existing
  }

  /** session 挂载：挂载行 + workspace 清单 sessions[] 追加（CAS）+ 本地投影更新。 */
  async function mountSession(workspace: string, sessionId: string): Promise<MountRow> {
    const safe = sanitizeName(workspace)
    await remote.put(mountKey(safe, sessionId), enc(JSON.stringify({ kind: 'session-mount', workspace: safe, session_id: sessionId, mounted_ms: Date.now() })), { mime: 'application/json' })
    await putManifestCas(safe, (m) => {
      if (!m.sessions.includes(sessionId)) m.sessions.push(sessionId)
    })
    // 本地投影与远端清单对齐（含对手条目）——挂载表是投影非真源。
    const cur = await remote.get(wsKey(safe))
    let sessions: string[] = []
    try {
      sessions = cur !== null ? ((JSON.parse(dec(cur.bytes)) as { sessions?: string[] }).sessions ?? []) : []
    } catch (e) {
      // 清单读回坏行不炸挂载流程——行已写、投影按空 sessions 落（审查三轮）。
      console.warn(`[remote-sync] workspace ${safe} 清单读回坏行——投影落空 sessions`)
      reportSilent(e, { op: 'vfs-manifest-readback', lane: 'background', workspace: safe })
    }
    const mount: MountRow = { name: safe, workspace: safe, sessions, created_ms: vfsStore.getMount(safe)?.created_ms ?? Date.now() }
    vfsStore.putMount(mount)
    return mount
  }

  /** 远端 workspace 清单 → 本地 /mnt 投影重建（返回 workspace 名列表）。
   *  sessions/* 挂载行并入清单 sessions[]——清单丢条目时挂载行仍可真源复活。 */
  async function pullWorkspaces(): Promise<string[]> {
    const keys = await remote.list('workspaces/', 500)
    const names = new Set<string>()
    for (const key of keys) {
      const m = key.match(/^workspaces\/([^/]+)\.json$/)
      if (m !== null) {
        const r = await remote.get(key)
        if (r === null) continue
        try {
          const w = JSON.parse(dec(r.bytes)) as { name: string; sessions?: string[]; created_ms?: number }
          vfsStore.putMount({ name: w.name, workspace: w.name, sessions: w.sessions ?? [], created_ms: w.created_ms ?? Date.now() })
          names.add(w.name)
        } catch (e) {
          /* 坏行跳过——台账留痕与 pullRows 同型（MN03-R2 B-1） */
          reportSilent(e, { op: 'vfs-pull-workspaces', lane: 'background', key })
        }
        continue
      }
      // sessions/{sid}.json 挂载行：清单丢条目时的自愈源；
      // 清单整失时行自带 {workspace,session_id}——据此重建挂载而非孤儿化（审查 B8）。
      const sm = key.match(/^workspaces\/([^/]+)\/sessions\/([^/]+)\.json$/)
      if (sm !== null) {
        const mount = vfsStore.getMount(sm[1]) ?? { name: sm[1], workspace: sm[1], sessions: [], created_ms: Date.now() }
        if (!mount.sessions.includes(sm[2])) {
          vfsStore.putMount({ ...mount, sessions: [...mount.sessions, sm[2]] })
          names.add(sm[1])
        }
      }
    }
    return [...names]
  }

  return { syncedMap, pushPath, pushAll, pushRemove, pullRows, hydrate, hydrateMissing, createWorkspace, mountSession, pullWorkspaces }
}

export type VfsSync = ReturnType<typeof createVfsSync>
