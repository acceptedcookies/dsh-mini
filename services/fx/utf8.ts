/** UTF-8 编解码兜底：JSC 缺 TextEncoder/TextDecoder 时使用。 */

export function encodeUtf8(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i)
      c = ((c - 0xd800) << 10) + c2 - 0xdc00 + 0x10000
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return new Uint8Array(out)
}

export function decodeUtf8(b: Uint8Array): string {
  let s = ''
  let i = 0
  while (i < b.length) {
    const c = b[i++]
    if (c < 0x80) {
      s += String.fromCharCode(c)
      continue
    }
    let code: number
    let n: number
    if (c < 0xe0) {
      code = c & 0x1f
      n = 1
    } else if (c < 0xf0) {
      code = c & 0x0f
      n = 2
    } else {
      code = c & 0x07
      n = 3
    }
    for (let j = 0; j < n; j++) code = (code << 6) | (b[i++] & 0x3f)
    if (code < 0x10000) s += String.fromCharCode(code)
    else {
      const v = code - 0x10000
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    }
  }
  return s
}

interface TextEncoderLike {
  encode(s: string): Uint8Array
}
interface TextDecoderLike {
  decode(b: Uint8Array): string
}
interface TextEncoderCtor {
  new (): TextEncoderLike
}
interface TextDecoderCtor {
  new (): TextDecoderLike
}

const globalAny = globalThis as unknown as Record<string, unknown>

export const TextEncoderImpl: TextEncoderCtor =
  (globalAny.TextEncoder as TextEncoderCtor | undefined) ??
  class {
    encode(s: string): Uint8Array {
      return encodeUtf8(s)
    }
  }

export const TextDecoderImpl: TextDecoderCtor =
  (globalAny.TextDecoder as TextDecoderCtor | undefined) ??
  class {
    decode(b: Uint8Array): string {
      return decodeUtf8(b)
    }
  }
