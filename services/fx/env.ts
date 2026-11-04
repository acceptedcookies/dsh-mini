/** WX 宿主能力适配：WXWebAssembly.instantiate + wx.request 分块 fetch + 随机数兜底。 */
import { TextDecoderImpl, TextEncoderImpl } from './utf8'

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

class WasmExit extends Error {}

export function createWxEnv(): FxEnv {
  const wxAny = globalThis as unknown as { WXWebAssembly?: { instantiate(p: string, i: unknown): Promise<unknown> } }
  return {
    fetch: wxFetch,
    getRandomValues,
    instantiate: async (path, imports) => {
      const w = wxAny.WXWebAssembly
      if (w === undefined) throw new Error('WXWebAssembly unavailable')
      // 实测 resolve {module, instance}（typings 声明为 Instance，以实测为准）
      const result = (await w.instantiate(path, imports)) as { instance: { exports: Record<string, any> } }
      return result
    },
    TextEncoder: TextEncoderImpl as unknown as TextEncoderCtor,
    TextDecoder: TextDecoderImpl as unknown as TextDecoderCtor,
    WasmExit,
  }
}
