/**
 * paths —— 五根 lane 裁决器（与 nano-agent WORKSPACE_LANE_ROOTS 同构照抄）。
 * 路径自身决定 lane：无请求侧 scope 字段、无别名兼容。
 * 上游：context/nano-agent/packages/nacp-core/src/tools/workspace-path-contract.ts
 */

export type VfsLaneRoot = '/root' | '/data' | '/mnt' | '/tmp' | '/backup'
export const VFS_LANE_ROOTS: readonly VfsLaneRoot[] = ['/root', '/data', '/mnt', '/tmp', '/backup']

export type VfsLane = 'hub' | 'session' | 'scratch' | 'mount' | 'backup'

/** 与 nano WORKSPACE_READ_ONLY_PREFIXES 对齐；/artifacts 是保留名不是第六根。 */
export const VFS_READ_ONLY_PREFIXES: readonly string[] = ['/mnt', '/backup', '/root/.profile', '/artifacts']

const DATA_ARTIFACTS = /^\/data\/[^/]+\/artifacts(?:\/|$)/
const ILLEGAL_CHARS = /[\u0000-\u001f\u007f]/

export interface ResolvedPath {
  /** 规范化绝对路径（cwd 已并入，无尾斜杠）。 */
  absolute: string
  lane: VfsLane
  laneRoot: VfsLaneRoot
  /** /data/{session} 或 /mnt/{name} 的第一段子键；无则 undefined。 */
  laneKey?: string
  readOnly: boolean
}

export type PathErrorCode = 'unsafe-workspace-path' | 'read-only-path' | 'path-not-found'

export class VfsError extends Error {
  readonly code: PathErrorCode | 'backend-unavailable' | 'overflow' | 'bytes-missing' | 'hash-mismatch' | 'fence-blocked'
  constructor(code: VfsError['code'], message: string) {
    super(message)
    this.name = 'VfsError'
    this.code = code
  }
}

/** 会话 cwd 法则：工作目录恒为 /data/{session_id}（同 nano）。 */
export function sessionCwd(sessionId: string): string {
  return `/data/${sessionId}`
}

function normalize(input: string, cwd: string): string {
  let p = input.trim()
  if (p.length === 0) throw new VfsError('unsafe-workspace-path', 'empty path')
  if (!p.startsWith('/')) p = `${cwd}/${p}`
  if (ILLEGAL_CHARS.test(p)) throw new VfsError('unsafe-workspace-path', `illegal characters in ${p}`)
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') throw new VfsError('unsafe-workspace-path', `relative escape in ${p}`)
    if (seg.indexOf('\\') !== -1) throw new VfsError('unsafe-workspace-path', `backslash in ${p}`)
    parts.push(seg)
  }
  return '/' + parts.join('/')
}

const LANE_OF: Record<VfsLaneRoot, VfsLane> = {
  '/root': 'hub',
  '/data': 'session',
  '/tmp': 'scratch',
  '/mnt': 'mount',
  '/backup': 'backup',
}

/**
 * 唯一裁决器：解析为 {absolute, lane, laneKey, readOnly}。
 * 与 nano resolveWorkspacePathTarget 同语义：五根闭集外一律 unsafe-workspace-path
 * （/workspace、相对逃逸、裸文件名歧义均拒绝）。
 */
export function resolveVfsPath(input: string, sessionId: string): ResolvedPath {
  const absolute = normalize(input, sessionCwd(sessionId))
  if (absolute === '/') return { absolute, lane: 'session', laneRoot: '/data', readOnly: true }
  const first = `/${absolute.split('/')[1]}` as VfsLaneRoot
  if (!(VFS_LANE_ROOTS as readonly string[]).includes(first)) {
    throw new VfsError('unsafe-workspace-path', `${absolute} 不在五根闭集内（/root /data /mnt /tmp /backup）`)
  }
  const lane = LANE_OF[first]
  const laneKey = absolute.split('/')[2]
  let readOnly = VFS_READ_ONLY_PREFIXES.some((prefix) => absolute === prefix || absolute.startsWith(`${prefix}/`))
  if (!readOnly && DATA_ARTIFACTS.test(absolute)) readOnly = true
  return { absolute, lane, laneRoot: first, laneKey, readOnly }
}

/** 写操作闸门：只读面直接拒绝（同 nano read-only-path）。 */
export function assertWritable(resolved: ResolvedPath): void {
  if (resolved.readOnly) {
    throw new VfsError('read-only-path', `${resolved.absolute} 所在 lane 为只读（写入请使用 /tmp、/data/<session> 或 /root）`)
  }
}
