// wx-shim —— Node 侧最小 wx 宿主替身：storage Map + USER_DATA_PATH + FSM(Node fs)。
// 仅覆盖 services 用到的 API 面：get/set/removeStorageSync、env.USER_DATA_PATH、
// getFileSystemManager{access,mkdir,readFile,writeFile,rename,unlink}Sync、base64 互转、request。
import { mkdtempSync, mkdirSync, accessSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const store = new Map()
const root = mkdtempSync(join(tmpdir(), 'mn01-wx-'))

globalThis.wx = {
  env: { USER_DATA_PATH: root },
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => void store.set(k, v),
  removeStorageSync: (k) => void store.delete(k),
  arrayBufferToBase64: (buf) => Buffer.from(buf).toString('base64'),
  base64ToArrayBuffer: (b64) => {
    const b = Buffer.from(b64, 'base64')
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  },
  getFileSystemManager: () => ({
    accessSync: (p) => accessSync(String(p)),
    mkdirSync: (p, recursive) => mkdirSync(String(p), { recursive: recursive === true }),
    readFileSync: (p, encoding) => {
      const b = readFileSync(String(p))
      return encoding === 'base64' ? b.toString('base64') : b.toString(encoding ?? 'utf8')
    },
    writeFileSync: (p, data, encoding) =>
      writeFileSync(String(p), encoding === 'base64' ? Buffer.from(data, 'base64') : data),
    renameSync: (a, b) => renameSync(String(a), String(b)),
    unlinkSync: (p) => unlinkSync(String(p)),
  }),
  request: () => { throw new Error('wx.request 未在 shim 实现——网络面请注入 post/request 替身') },
}

export const __store = store
export const __root = root
