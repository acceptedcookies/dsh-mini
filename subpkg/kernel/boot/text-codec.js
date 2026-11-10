/**
 * kernel 分包内的最小 TextEncoder/TextDecoder 兜底。
 * 分包 boot 组件 require kernel.js 早于主包 App.onLaunch 的 shim 时，
 * JSC 没有 TextEncoder，kernel 顶层会在 require 阶段直接 ReferenceError。
 * 这里只补 UTF-8 编解码，与 services/fx/utf8.ts 同语义，不引主包模块。
 */
function encodeUtf8(s) {
  const out = []
  for (let i = 0; i < s.length; i += 1) {
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

function decodeUtf8(b) {
  let s = ''
  let i = 0
  while (i < b.length) {
    const c = b[i++]
    if (c < 0x80) {
      s += String.fromCharCode(c)
      continue
    }
    let code
    let n
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
    for (let j = 0; j < n; j += 1) code = (code << 6) | (b[i++] & 0x3f)
    if (code < 0x10000) s += String.fromCharCode(code)
    else {
      const v = code - 0x10000
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    }
  }
  return s
}

function installTextCodec() {
  if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = class {
      encode(value) {
        return encodeUtf8(String(value))
      }
    }
  }
  if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = class {
      decode(value) {
        return decodeUtf8(value instanceof Uint8Array ? value : new Uint8Array(value))
      }
    }
  }
}

module.exports = { installTextCodec }
