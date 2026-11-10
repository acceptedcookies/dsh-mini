/**
 * 宿主 shim 面（T-O-B8）：kernel bundle 在 mp JSC 需要的 Web API 替身。
 * - crypto.subtle.digest('SHA-256') → services/vfs/sha256.ts 纯 TS 实现
 * - atob/btoa → wx.base64ToArrayBuffer / wx.arrayBufferToBase64
 * - TextEncoder/TextDecoder → services/fx/utf8.ts 实现
 * 宿主感知：仅在 mp 环境（globalThis.wx 存在）注册；Node 侧 no-op（sweeper 不污染）。
 * 幂等：重复调用返回同一注册结果。
 */

import { sha256Hex } from '../vfs/sha256'
import { TextEncoderImpl, TextDecoderImpl } from '../fx/utf8'

declare const globalThis: {
  wx?: { base64ToArrayBuffer(b64: string): ArrayBuffer; arrayBufferToBase64(buf: ArrayBuffer): string }
  crypto?: {
    getRandomValues?: (buf: Uint8Array) => Uint8Array
    subtle?: { digest(algo: string, data: ArrayBuffer): Promise<ArrayBuffer> }
  }
  atob?: (s: string) => string
  btoa?: (s: string) => string
  TextEncoder?: unknown
  TextDecoder?: unknown
} & Record<string, unknown>

let installed = false

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes.buffer
}

/** mp 环境注册全部 shim；Node 环境返回 false（调用方据此判定宿主）。 */
export function installKernelShims(): boolean {
  if (installed) return globalThis.wx !== undefined
  installed = true
  const wxApi = globalThis.wx
  if (wxApi === undefined) return false // Node / sweeper：原生 API 齐备，不污染

  if (globalThis.crypto === undefined || globalThis.crypto.subtle === undefined) {
    const prev = globalThis.crypto
    const subtle = {
      digest(algo: string, data: ArrayBuffer): Promise<ArrayBuffer> {
        const name = algo.toUpperCase().replace('-', '')
        if (name !== 'SHA256') return Promise.reject(new Error(`unsupported digest ${algo}`))
        return Promise.resolve(hexToArrayBuffer(sha256Hex(new Uint8Array(data))))
      },
    }
    // 只补 digest。已有 getRandomValues 必须留下；禁止换成只有 digest 的对象。
    globalThis.crypto = prev?.getRandomValues !== undefined
      ? { getRandomValues: prev.getRandomValues.bind(prev), subtle }
      : { ...(prev ?? {}), subtle }
  }

  if (globalThis.atob === undefined) {
    globalThis.atob = (b64: string): string => {
      const buf = wxApi.base64ToArrayBuffer(b64)
      let s = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
      return s
    }
  }
  if (globalThis.btoa === undefined) {
    globalThis.btoa = (bin: string): string => {
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff
      return wxApi.arrayBufferToBase64(bytes.buffer)
    }
  }

  if (globalThis.TextEncoder === undefined) globalThis.TextEncoder = TextEncoderImpl
  if (globalThis.TextDecoder === undefined) globalThis.TextDecoder = TextDecoderImpl

  return true
}

/** 测试/诊断用：报告 shim 面覆盖状态（不注册）。 */
export function shimCoverage(): { cryptoSubtle: boolean; atob: boolean; btoa: boolean; textCodec: boolean } {
  return {
    cryptoSubtle: globalThis.crypto?.subtle?.digest !== undefined,
    atob: globalThis.atob !== undefined,
    btoa: globalThis.btoa !== undefined,
    textCodec: globalThis.TextEncoder !== undefined && globalThis.TextDecoder !== undefined,
  }
}
