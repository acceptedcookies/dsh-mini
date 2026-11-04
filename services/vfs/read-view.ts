/**
 * read-view —— 有界陈旧热视图（与 nano agent-execution-read-face 同构）。
 * capture → immutable population + root_digest → manifest 页读 + 对象 range 读。
 * 形状照 nano 合同；本地 qualification 为自签内省（不声称 nano 级验收语义）。
 */
import { VfsError, type VfsLane } from './paths'
import { vfsStore, type VfsManifest, type VfsManifestEntry } from './store'
import { localObjects } from './objects'
import { vfsJournal } from './journal'
import { sha256Hex } from './sha256'
import { encodeUtf8, decodeUtf8 } from '../fx/utf8'
import { randomId } from '../../utils/uuid'

export const READ_VIEW_ALGORITHM = 'vfs-read-view.v1'
/** P-VIEW 同族预算（本地缩编值，rules/filesystem.md §10-6）。 */
export const READ_VIEW_BOUNDS: {
  manifest_entries: number
  manifest_bytes: number
  page_limit: number
  range_max_bytes: number
  ttl_ms: number
} = {
  manifest_entries: 4096,
  manifest_bytes: 512 * 1024,
  page_limit: 200,
  range_max_bytes: 256 * 1024,
  ttl_ms: 30 * 60 * 1000,
}

export interface CaptureResult {
  manifest_uuid: string
  read_view_revision: string
  root_digest: string
  population_count: number
  created_at: string
  expiry_at: string
}

function scopeRank(lane: VfsLane): number {
  const rank: Record<VfsLane, number> = { hub: 0, session: 1, scratch: 2, mount: 3, backup: 4 }
  return rank[lane]
}

/** nano canonicalJson 形态：键序固定、无空白。字段序即合同面。 */
function canonicalJson(entry: VfsManifestEntry): string {
  const parts = [
    `"normalized_path":${JSON.stringify(entry.normalized_path)}`,
    `"scope":${JSON.stringify(entry.scope)}`,
    `"content_hash":${JSON.stringify(entry.content_hash)}`,
    `"object_version":${JSON.stringify(entry.object_version)}`,
    `"size_bytes":${entry.size_bytes}`,
  ]
  if (entry.mime !== undefined) parts.push(`"mime":${JSON.stringify(entry.mime)}`)
  return `{${parts.join(',')}}`
}

function population(): VfsManifestEntry[] {
  return vfsStore
    .allRows()
    .filter((r) => r.committed)
    .map((r) => ({
      normalized_path: r.virtual_path,
      scope: r.lane,
      content_hash: r.content_hash,
      object_version: r.content_hash, // 本地 object_version = content_hash（行即真源）
      size_bytes: r.size_bytes,
      mime: r.mime,
    }))
    .sort((a, b) => a.normalized_path.localeCompare(b.normalized_path))
}

function requireManifest(uuid: string): VfsManifest {
  const m = vfsStore.getManifest(uuid)
  if (m === undefined) throw new VfsError('path-not-found', `manifest ${uuid} 不存在`)
  if (Date.parse(m.expiry_at) < Date.now()) {
    vfsStore.removeManifest(uuid)
    throw new VfsError('path-not-found', `manifest ${uuid} 已过期`)
  }
  return m
}

export const vfsReadView = {
  /**
   * 捕获当前 population → manifest（immutable）。
   * fence：pending mutation > 0 时 fence-blocked（单进程下常态为 0，形态保留）。
   */
  capture(): CaptureResult {
    if (vfsJournal.pendingCount() > 0) {
      throw new VfsError('fence-blocked', `存在 ${vfsJournal.pendingCount()} 个未完成 mutation`)
    }
    const entries = population()
    if (entries.length > READ_VIEW_BOUNDS.manifest_entries) {
      throw new VfsError('overflow', `population ${entries.length} 超出 manifest_entries 预算`)
    }
    const populationJson = `[${entries.map(canonicalJson).join(',')}]`
    if (populationJson.length > READ_VIEW_BOUNDS.manifest_bytes) {
      throw new VfsError('overflow', `manifest ${populationJson.length}B 超出预算`)
    }
    const root_digest = `sha256:${sha256Hex(encodeUtf8(populationJson))}`
    const now = Date.now()
    const manifest: VfsManifest = {
      manifest_uuid: randomId('manifest'),
      read_view_revision: `${now.toString(36)}-${entries.length}`,
      root_digest,
      population_count: entries.length,
      algorithm_version: READ_VIEW_ALGORITHM,
      created_at: new Date(now).toISOString(),
      expiry_at: new Date(now + READ_VIEW_BOUNDS.ttl_ms).toISOString(),
      entries,
    }
    vfsStore.putManifest(manifest)
    return {
      manifest_uuid: manifest.manifest_uuid,
      read_view_revision: manifest.read_view_revision,
      root_digest,
      population_count: entries.length,
      created_at: manifest.created_at,
      expiry_at: manifest.expiry_at,
    }
  },

  /** manifest 页读（cursor = 下标，next_cursor 为 null 即完）。 */
  readManifestPage(uuid: string, cursor?: string, limit?: number): { entries: VfsManifestEntry[]; next_cursor: string | null; read_view_revision: string } {
    const m = requireManifest(uuid)
    const lim = Math.min(limit ?? READ_VIEW_BOUNDS.page_limit, READ_VIEW_BOUNDS.page_limit)
    const start = cursor !== undefined ? Number.parseInt(cursor, 10) || 0 : 0
    const page = m.entries.slice(start, start + lim)
    return {
      entries: page,
      next_cursor: start + lim < m.entries.length ? String(start + lim) : null,
      read_view_revision: m.read_view_revision,
    }
  },

  /**
   * 对象 range 读：path 必须在 manifest population 内（version-mismatch 语义：
   * 传入 expected_version 且与 manifest 记录不符时拒绝）。
   */
  readObjectRange(
    uuid: string,
    path: string,
    offset: number,
    maxBytes: number,
    expectedVersion?: string,
  ): { bytes: string; encoding: 'utf8'; eof: boolean; read_view_revision: string; object_version: string } {
    const m = requireManifest(uuid)
    const entry = m.entries.find((e) => e.normalized_path === path)
    if (entry === undefined) throw new VfsError('path-not-found', `${path} 不在 manifest population`)
    if (expectedVersion !== undefined && expectedVersion !== entry.object_version) {
      throw new VfsError('hash-mismatch', `${path} object_version 与 manifest 不符`)
    }
    const lim = Math.min(maxBytes, READ_VIEW_BOUNDS.range_max_bytes)
    const bytes = localObjects.read(entry.object_version.replace(/^sha256:/, ''))
    const start = Math.max(0, offset)
    const slice = bytes.slice(start, Math.min(start + lim, bytes.byteLength))
    return {
      bytes: decodeUtf8(new Uint8Array(slice)),
      encoding: 'utf8',
      eof: start + slice.byteLength >= bytes.byteLength,
      read_view_revision: m.read_view_revision,
      object_version: entry.object_version,
    }
  },

  /** 对象层 key 即 content_hash hex；scopeRank 供测试断言页序。 */
  __internal: { scopeRank },
}
