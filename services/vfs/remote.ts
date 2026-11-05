/**
 * remote —— POD1 fss3 收窄面客户端（/v1/vfs/* + /v1/artifacts/publish）。
 * 与 remote-cas 同车道：wx.request POST，Authorization 由调用方注入
 * （真云 unlock 票据，scope=byok-proxy，oid 服务端注入）。
 * 线键约定：`vfs/{rest}` → 服务端拼 `dsh-mini/vfs/{oid}/{rest}`；本层只管
 * `vfs/` 前缀内的相对键，owner 永远不上线。
 */
import { VfsError } from './paths'

export interface RemoteVfsDeps {
  baseUrl: string
  /** 每调用解析票据头（ticket provider authHeaders）。 */
  headers?: () => Promise<Record<string, string>> | Record<string, string>
  /** 测试注入：替换 wx.request 通道。 */
  post?: (url: string, headers: Record<string, string>, body: unknown) => Promise<{ status: number; body: unknown }>
}

function wxPost(url: string, headers: Record<string, string>, data: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method: 'POST', header: headers,
      data: data as Record<string, unknown>, timeout: 30000,
      success: (res) => resolve({ status: res.statusCode, body: res.data }),
      fail: (err) => reject(new Error(err.errMsg ?? 'wx.request failed')),
    })
  })
}

const MAX_OBJ_BYTES = 8 * 1024 * 1024

export interface RemoteVfsPutResult {
  etag: string
  size: number
  objectKey: string
}

export interface RemoteVfsGetResult {
  bytes: ArrayBuffer
  etag: string
  size: number
  eof: boolean
}

export interface RemoteArtifactResult {
  sha256: string
  url: string
  objectKey: string
}

function toB64(bytes: ArrayBuffer): string {
  return wx.arrayBufferToBase64(bytes)
}

function fromB64(b64: string): ArrayBuffer {
  return wx.base64ToArrayBuffer(b64)
}

export function createRemoteVfs(deps: RemoteVfsDeps) {
  const post = deps.post ?? wxPost
  const base = deps.baseUrl.replace(/\/$/, '')

  const call = async (ep: string, payload: unknown): Promise<{ status: number; body: unknown }> => {
    const h = await Promise.resolve(deps.headers?.() ?? {})
    return post(`${base}${ep}`, { 'content-type': 'application/json', ...h }, payload)
  }

  const err = (op: string, r: { status: number; body: unknown }): never => {
    throw new VfsError('backend-unavailable', `remote ${op} → ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`)
  }

  return {
    /** 写对象/行字节；key 为 `vfs/` 内相对键（如 objects/{sha}、rows/…）。
     *  ifNoneMatch=create-only；ifMatch=etag 条件写（manifest CAS 用）。 */
    async put(key: string, bytes: ArrayBuffer, opts: { mime?: string; ifNoneMatch?: boolean; ifMatch?: string } = {}): Promise<RemoteVfsPutResult> {
      if (bytes.byteLength > MAX_OBJ_BYTES) throw new VfsError('overflow', `remote vfs 对象 >8MB（${bytes.byteLength}B）`)
      const r = await call('/v1/vfs/put', {
        key: `vfs/${key}`, bytes_b64: toB64(bytes), mime: opts.mime,
        if_none_match: opts.ifNoneMatch === true ? true : undefined,
        if_match: opts.ifMatch,
      })
      if (r.status === 412) throw new VfsError('fence-blocked', `remote ${key} 已存在（if-none-match）`)
      if (r.status !== 200) return err('vfs/put', r)
      const b = r.body as { etag: string; size: number; object_key: string }
      return { etag: b.etag, size: b.size, objectKey: b.object_key }
    },

    /** 读对象；不存在返回 null（区别于传输错误——后者 throw）。 */
    async get(key: string, opts: { offset?: number; maxBytes?: number } = {}): Promise<RemoteVfsGetResult | null> {
      const r = await call('/v1/vfs/get', { key: `vfs/${key}`, offset: opts.offset ?? 0, max_bytes: opts.maxBytes })
      if (r.status === 404) return null
      if (r.status !== 200) return err('vfs/get', r)
      const b = r.body as { body_b64: string; etag: string; size: number; eof: boolean }
      return { bytes: fromB64(b.body_b64), etag: b.etag, size: b.size, eof: b.eof }
    },

    /** 删对象；返回是否真的删掉了行（对象共享引用时语义见调用方）。 */
    async del(key: string): Promise<boolean> {
      const r = await call('/v1/vfs/del', { key: `vfs/${key}` })
      if (r.status !== 200) return err('vfs/del', r)
      return (r.body as { removed: boolean }).removed === true
    },

    /** 前缀列举：prefix 为 `vfs/` 内相对前缀；start_after 续页（服务端 truncated/next_token）。 */
    async list(prefix: string, limit = 500, startAfter?: string): Promise<string[]> {
      const keys: string[] = []
      let token = startAfter
      do {
        const r = await call('/v1/vfs/list', { prefix: `vfs/${prefix}`, limit, start_after: token })
        if (r.status !== 200) return err('vfs/list', r)
        const b = r.body as { keys: string[]; truncated?: boolean; next_token?: string }
        for (const k of b.keys ?? []) {
          if (k.startsWith('vfs/')) keys.push(k.slice('vfs/'.length))
        }
        token = b.truncated === true ? b.next_token : undefined
      } while (token !== undefined)
      return keys
    },

    /** artifacts 公网出口：content-hash 寻址 + 公网 URL（G4 图像双形态之一）。 */
    async publishArtifact(bytes: ArrayBuffer, mime: string): Promise<RemoteArtifactResult> {
      if (bytes.byteLength > MAX_OBJ_BYTES) throw new VfsError('overflow', `artifact >8MB（${bytes.byteLength}B）`)
      const r = await call('/v1/artifacts/publish', { bytes_b64: toB64(bytes), mime })
      if (r.status !== 200) return err('artifacts/publish', r)
      const b = r.body as { sha256: string; url: string; object_key: string }
      return { sha256: b.sha256, url: b.url, objectKey: b.object_key }
    },
  }
}

export type RemoteVfs = ReturnType<typeof createRemoteVfs>
