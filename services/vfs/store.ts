/**
 * store —— VFS 元数据真源（wx.storage，D1 行 analog）。
 * 单键 map 落盘（原子写整对象），行小且总量受 storage 配额闸。
 */
import type { VfsLane } from './paths'

export type VfsPlacement = 'local-scratch' | 'local-hub' | 'cloud-pinned' | 's3-pinned'

export interface VfsRow {
  virtual_path: string
  object_key: string
  content_hash: string
  size_bytes: number
  mime?: string
  placement: VfsPlacement
  lane: VfsLane
  committed: boolean
  updated_ms: number
}

export interface VfsManifest {
  manifest_uuid: string
  read_view_revision: string
  root_digest: string
  population_count: number
  algorithm_version: string
  created_at: string
  expiry_at: string
  entries: VfsManifestEntry[]
}

export interface VfsManifestEntry {
  normalized_path: string
  scope: VfsLane
  content_hash: string
  object_version: string
  size_bytes: number
  mime?: string
}

/** S3 后端占位配置（合约面，未启用——见 rules/filesystem.md §4）。 */
export interface S3BackendConfig {
  endpoint: string
  bucket: string
  region: string
  path_style: boolean
  /** 密钥不落 storage：只存引用名，真实密钥走 BYOK 托管管道。 */
  access_key_ref?: string
  configured_ms: number
}

const ROWS_KEY = 'dsh:vfs:v1:rows'
const MANIFESTS_KEY = 'dsh:vfs:v1:manifests'
const S3CFG_KEY = 'dsh:vfs:v1:s3'
/** storage 全量预算 10MB 与全应用共享；VFS 行面自留 6MB 闸。 */
const ROWS_BUDGET = 6 * 1024 * 1024
const MANIFEST_BUDGET = 2 * 1024 * 1024

function readMap<T>(key: string): Record<string, T> {
  const value = wx.getStorageSync(key) as Record<string, T> | '' | undefined
  return value !== '' && value !== undefined ? value : {}
}

function writeMap<T>(key: string, map: Record<string, T>, budget: number): void {
  const bytes = JSON.stringify(map).length
  if (bytes > budget) {
    const err = new Error(`vfs ${key} 超出预算 ${budget}B（当前 ${bytes}B）`)
    ;(err as Error & { code?: string }).code = 'overflow'
    throw err
  }
  wx.setStorageSync(key, map)
}

export const vfsStore = {
  getRow(path: string): VfsRow | undefined {
    return readMap<VfsRow>(ROWS_KEY)[path]
  },
  putRow(row: VfsRow): void {
    const map = readMap<VfsRow>(ROWS_KEY)
    map[row.virtual_path] = row
    writeMap(ROWS_KEY, map, ROWS_BUDGET)
  },
  removeRow(path: string): VfsRow | undefined {
    const map = readMap<VfsRow>(ROWS_KEY)
    const row = map[path]
    if (row === undefined) return undefined
    delete map[path]
    writeMap(ROWS_KEY, map, ROWS_BUDGET)
    return row
  },
  allRows(): VfsRow[] {
    return Object.values(readMap<VfsRow>(ROWS_KEY))
  },
  rowsUnder(prefix: string): VfsRow[] {
    const norm = prefix === '/' ? '' : prefix.endsWith('/') ? prefix : `${prefix}/`
    return this.allRows().filter((r) => norm === '' || r.virtual_path.startsWith(norm) || r.virtual_path === prefix)
  },
  clearRows(): void {
    wx.removeStorageSync(ROWS_KEY)
  },

  putManifest(m: VfsManifest): void {
    const map = readMap<VfsManifest>(MANIFESTS_KEY)
    map[m.manifest_uuid] = m
    writeMap(MANIFESTS_KEY, map, MANIFEST_BUDGET)
  },
  getManifest(uuid: string): VfsManifest | undefined {
    return readMap<VfsManifest>(MANIFESTS_KEY)[uuid]
  },
  removeManifest(uuid: string): void {
    const map = readMap<VfsManifest>(MANIFESTS_KEY)
    if (map[uuid] === undefined) return
    delete map[uuid]
    writeMap(MANIFESTS_KEY, map, MANIFEST_BUDGET)
  },

  getS3Config(): S3BackendConfig | undefined {
    const value = wx.getStorageSync(S3CFG_KEY) as S3BackendConfig | '' | undefined
    return value === '' || value === undefined ? undefined : value
  },
  setS3Config(cfg: S3BackendConfig): void {
    wx.setStorageSync(S3CFG_KEY, cfg)
  },
  clearS3Config(): void {
    wx.removeStorageSync(S3CFG_KEY)
  },
}
