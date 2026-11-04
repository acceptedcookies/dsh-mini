/** WX 宿主能力适配：WXWebAssembly.instantiate + wx.request 分块 fetch + 随机数兜底。
 *  数据面 URL 以 `container://` 开头时改走 wx.cloud.callContainer（云托管内网车道）。 */
import { TextDecoderImpl, TextEncoderImpl } from './utf8'
import { callContainer, isContainerUrl, parseContainerUrl } from './container'
import { loadDevConfig } from './dev'
import { ensureSubpackageForPath } from '../subpackage'

export interface FetchLikeResult {
  status: number
  body: { read(): Promise<{ done: boolean; value?: Uint8Array }> }
  arrayBuffer(): Promise<ArrayBuffer>
  abort?(): void
}
export type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }) => Promise<FetchLikeResult>

export interface TextEncoderCtor {
  new (): { encode(s: string): Uint8Array }
}
export interface TextDecoderCtor {
  new (): { decode(b: Uint8Array): string }
}

export interface FxEnv {
  fetch: FetchLike
  getRandomValues(arr: Uint8Array): Uint8Array
  instantiate(path: string, imports: unknown): Promise<{ instance: { exports: Record<string, any> } }>
  TextEncoder: TextEncoderCtor
  TextDecoder: TextDecoderCtor
  WasmExit: new (message?: string) => Error
}

let seed = (Date.now() ^ 0x9e3779b9) >>> 0
function getRandomValues(arr: Uint8Array): Uint8Array {
  const g = globalThis as unknown as Record<string, unknown>
  const cryptoObj = g.crypto as { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined
  if (cryptoObj?.getRandomValues) return cryptoObj.getRandomValues(arr)
  const wxObj = g.wx as { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined
  if (typeof wxObj?.getRandomValues === 'function') return wxObj.getRandomValues(arr)
  // 兜底 xorshift32：非密码学用途；wasm 内仅用于会话 id/乱序，安全面由远端控制。
  for (let i = 0; i < arr.length; i++) {
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5
    seed >>>= 0
    arr[i] = seed & 0xff
  }
  return arr
}

export function wxFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }): Promise<FetchLikeResult> {
  // 容器车道：container://{service} → callContainer（内网；callContainer 缓冲返回，
  // 无分块语义——一次性 body 投递即 ended，与 wxFetch 消费方兼容）
  if (isContainerUrl(url)) {
    return containerFetch(url, init)
  }
  return new Promise((resolve, reject) => {
    const queue: Uint8Array[] = []
    let ended = false
    let failed: Error | null = null
    let status = 0
    let settled = false
    const waiters: Array<() => void> = []
    const wake = () => {
      waiters.splice(0).forEach((w) => w())
    }

    const response: FetchLikeResult = {
      get status() {
        return status
      },
      body: {
        read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (queue.length) return Promise.resolve({ done: false, value: queue.shift() })
          if (ended) return Promise.resolve({ done: true })
          if (failed) return Promise.reject(failed)
          return new Promise((res) => {
            waiters.push(() => res(response.body.read()))
          })
        },
      },
      async arrayBuffer(): Promise<ArrayBuffer> {
        const parts: Uint8Array[] = []
        for (;;) {
          const r = await this.body.read()
          if (r.done) break
          if (r.value) parts.push(r.value)
        }
        const total = parts.reduce((n, p) => n + p.length, 0)
        const out = new Uint8Array(total)
        let off = 0
        parts.forEach((p) => {
          out.set(p, off)
          off += p.length
        })
        return out.buffer
      },
      abort() {
        try {
          task.abort()
        } catch {
          /* noop */
        }
      },
    }

    let sawChunk = false
    const task = wx.request({
      url,
      method: (init.method || 'GET') as WechatMiniprogram.RequestOption['method'],
      data: init.body
        ? init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength)
        : undefined,
      header: init.headers || {},
      responseType: 'arraybuffer',
      enableChunked: true,
      success(res) {
        // 分块已送达时 success 的 data 是整包，避免重复投递
        const data = res.data as ArrayBuffer
        if (!sawChunk && data && data.byteLength) queue.push(new Uint8Array(data))
        ended = true
        wake()
        if (!settled) {
          settled = true
          status = res.statusCode
          resolve(response)
        }
      },
      fail(err) {
        failed = new Error(`wx.request fail: ${JSON.stringify(err)}`)
        ended = true
        wake()
        if (!settled) {
          settled = true
          reject(failed)
        }
      },
    })
    task.onHeadersReceived((res: { statusCode: number }) => {
      if (settled) return
      settled = true
      status = res.statusCode
      resolve(response)
    })
    task.onChunkReceived((res: { data: ArrayBuffer }) => {
      if (res.data && res.data.byteLength) {
        sawChunk = true
        queue.push(new Uint8Array(res.data))
        wake()
      }
    })
  })
}

/** container:// URL → callContainer。请求 body bytes 尝试 JSON 反序列化（proxy 收 JSON）。 */
function containerFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }): Promise<FetchLikeResult> {
  const envId = loadDevConfig()?.cloud?.envId ?? ''
  let data: unknown
  if (init.body !== undefined && init.body.byteLength > 0) {
    try {
      data = JSON.parse(new TextDecoderImpl().decode(init.body))
    } catch {
      data = init.body
    }
  }
  return callContainer(envId, url, { method: init.method ?? 'GET', headers: init.headers ?? {}, body: data })
    .then((r) => {
    const bytes =
      r.body instanceof ArrayBuffer
        ? new Uint8Array(r.body)
        : new TextEncoderImpl().encode(typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
    let sent = false
    return {
      status: r.status,
      body: {
        read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (sent) return Promise.resolve({ done: true })
          sent = true
          return Promise.resolve({ done: false, value: bytes })
        },
      },
      arrayBuffer(): Promise<ArrayBuffer> {
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        return Promise.resolve(copy.buffer)
      },
    }
  }, (e: unknown) => {
    // 传输层失败回退公网 proxy_url（同 io.llm 语义）；挂在 then 第二参，
    // 只兜 callContainer 拒绝，映射器异常不会误触发二次请求
    const pub = loadDevConfig()?.cloud?.proxyUrl
    if (pub === undefined || pub.length === 0) throw e
    console.warn(`[fx.env] callContainer 失败，回退公网 proxy: ${e instanceof Error ? e.message : String(e)}`)
    return wxFetch(pub + parseContainerUrl(url).path, init)
  })
}

class WasmExit extends Error {}

export function createWxEnv(): FxEnv {
  const wxAny = globalThis as unknown as { WXWebAssembly?: { instantiate(p: string, i: unknown): Promise<unknown> } }
  return {
    fetch: wxFetch,
    getRandomValues,
    instantiate: async (path, imports) => {
      const w = wxAny.WXWebAssembly
      if (w === undefined) throw new Error('WXWebAssembly unavailable')
      await ensureSubpackageForPath(path)
      // 普通分包经 preloadRule 异步下载——下载在途时 instantiate 报 load 错；
      // 轮询重试等就绪（最长 ~10s），确定性错误则满次数后原样抛出
      let lastErr: unknown
      for (let i = 0; i < 25; i++) {
        try {
          // 实测 resolve {module, instance}（typings 声明为 Instance，以实测为准）
          return (await w.instantiate(path, imports)) as { instance: { exports: Record<string, any> } }
        } catch (e) {
          lastErr = e
          if (i < 24) await new Promise((r) => setTimeout(r, 400))
        }
      }
      throw lastErr
    },
    TextEncoder: TextEncoderImpl as unknown as TextEncoderCtor,
    TextDecoder: TextDecoderImpl as unknown as TextDecoderCtor,
    WasmExit,
  }
}
