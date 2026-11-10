/**
 * 唯一真随机缝（MN07 P1-01 / T-O-21）。
 * 顺序只许 globalThis.crypto.getRandomValues，其次同步形态的 wx.getRandomValues。
 * 两源皆无抛 random-source-unavailable。不接受 seed，不导出 PRNG，不进 kernel 包。
 */

interface RandomSource {
  getRandomValues?: (buf: Uint8Array) => Uint8Array
}

function cryptoSource(): RandomSource | undefined {
  const c = (globalThis as { crypto?: RandomSource }).crypto
  if (c !== undefined && typeof c.getRandomValues === 'function') return c
  return undefined
}

function wxSource(): RandomSource | undefined {
  const wx = (globalThis as { wx?: { getRandomValues?: RandomSource['getRandomValues'] } }).wx
  if (wx !== undefined && typeof wx.getRandomValues === 'function') return wx
  return undefined
}

export function getRandomValues(buf: Uint8Array): Uint8Array {
  const cryptoObj = cryptoSource()
  if (cryptoObj?.getRandomValues !== undefined) return cryptoObj.getRandomValues(buf)
  const wxObj = wxSource()
  if (wxObj?.getRandomValues !== undefined) {
    const out = wxObj.getRandomValues(buf)
    if (out instanceof Uint8Array && out.length === buf.length) return out
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
