/**
 * 唯一真随机缝（MN07 P1-01 / T-O-21）。
 * 首选 globalThis.crypto.getRandomValues（同步）。
 * 微信真实 API 的 wx.getRandomValues 是 Promise 形态：{ randomValues: ArrayBuffer }。
 * 同步缝不能 await，因此在启动/每轮入口用 ensureRandomPool() 预先取真实随机字节，
 * getRandomValues() 从池里同步消费。池只存原始字节，不做 PRNG、不接受 seed。
 * 两源皆无（或池空）抛 random-source-unavailable。
 */

interface RandomSource {
  getRandomValues?: (buf: Uint8Array) => Uint8Array
}

interface WxAsyncSource {
  getRandomValues?: (options: { length: number }) => Promise<{ randomValues?: ArrayBuffer }> | Uint8Array
}

function cryptoSource(): RandomSource | undefined {
  const c = (globalThis as { crypto?: RandomSource }).crypto
  if (c !== undefined && typeof c.getRandomValues === 'function') return c
  return undefined
}

function wxSource(): WxAsyncSource | undefined {
  const wx = (globalThis as { wx?: WxAsyncSource }).wx
  if (wx !== undefined && typeof wx.getRandomValues === 'function') return wx
  return undefined
}

let pool: Uint8Array = new Uint8Array(0)

/** 小程序 wx 返回的是跨 realm 的 ArrayBuffer，instanceof 不可靠。 */
function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

function isBytes(value: unknown): value is Uint8Array {
  if (value === null || typeof value !== 'object') return false
  const row = value as { length?: unknown; byteLength?: unknown }
  return typeof row.length === 'number' && typeof row.byteLength === 'number'
}

function append(bytes: Uint8Array): void {
  if (bytes.length === 0) return
  const next = new Uint8Array(pool.length + bytes.length)
  next.set(pool)
  next.set(bytes, pool.length)
  pool = next
}

/**
 * 预取真实随机字节。有同步 crypto 源时直接返回（无需池）。
 * 只有 Promise 形态的 wx.getRandomValues 时才填池。
 */
export async function ensureRandomPool(bytes = 4096): Promise<void> {
  if (cryptoSource() !== undefined) return
  const wxApi = wxSource()
  if (wxApi?.getRandomValues === undefined) return
  try {
    const result = await wxApi.getRandomValues({ length: bytes })
    if (isBytes(result)) {
      append(result)
      return
    }
    const buf = result?.randomValues
    if (isArrayBufferLike(buf)) append(new Uint8Array(buf))
  } catch {
    // 取不到就保持池现状；真正消费时仍无字节则抛 random-source-unavailable。
  }
}

export function randomPoolSize(): number {
  return pool.length
}

export function getRandomValues(buf: Uint8Array): Uint8Array {
  const cryptoObj = cryptoSource()
  if (cryptoObj?.getRandomValues !== undefined) return cryptoObj.getRandomValues(buf)

  // 旧基础库/测试注入的同步形态：函数带 1 个形参且直接返回 Uint8Array 才算成功。
  const wxApi = wxSource()
  if (wxApi?.getRandomValues !== undefined && wxApi.getRandomValues.length >= 1) {
    try {
      const out = wxApi.getRandomValues(buf as unknown as { length: number }) as unknown
      if (isBytes(out) && out.length === buf.length) return out as Uint8Array
    } catch {
      // 非同步实现——落到池。
    }
  }

  if (pool.length >= buf.length) {
    buf.set(pool.subarray(0, buf.length))
    pool = pool.subarray(buf.length)
    return buf
  }
  throw new Error('random-source-unavailable')
}

/** RFC 4122 v4：version nibble 0100，variant 10，8-4-4-4-12 小写 hex。 */
export function randomUUID(): string {
  const bytes = getRandomValues(new Uint8Array(16))
  const b6 = bytes[6] ?? 0
  const b8 = bytes[8] ?? 0
  bytes[6] = (b6 & 0x0f) | 0x40
  bytes[8] = (b8 & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
