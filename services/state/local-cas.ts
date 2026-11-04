/**
 * localCas —— wx.storage 之上的 CAS 替身（T-O-8 io.state mp 侧实现）。
 * 键区：storage 内 `dsh:mini:kv/<key>`；etag = `dsh:mini:etag` 单调计数行。
 * 语义等价 kernel-do CasStore：If-Match/If-None-Match 条件写 + claim 租约。
 * 风险登记（QNA §5.3 / AP ⛔4）：单线程 appService 内读-改-写原子（同步 API）；
 * 一旦出现并发写源（worker/插件/多页面同时 pump），改接真后端五端点。
 */

import type { CasGetResult, CasPutCond, CasPutResult, IoState } from '../nano-mini-host/types'

const KV_PREFIX = 'dsh:mini:kv/'
const ETAG_KEY = 'dsh:mini:etag'

interface CasRow {
  body: string
  etag: string
}

function readRow(key: string): CasRow | null {
  const value = wx.getStorageSync(KV_PREFIX + key) as CasRow | '' | undefined
  return value === '' || value === undefined ? null : value
}

function nextEtag(): string {
  const cur = wx.getStorageSync(ETAG_KEY) as number | '' | undefined
  const next = (typeof cur === 'number' ? cur : 0) + 1
  wx.setStorageSync(ETAG_KEY, next)
  return `e${next}`
}

/** 前缀列举：wx.storage 无列举 API，用 dsh:mini:index 键集合行维护索引。 */
const INDEX_KEY = 'dsh:mini:index'

function readIndex(): string[] {
  const value = wx.getStorageSync(INDEX_KEY) as string[] | '' | undefined
  return Array.isArray(value) ? value : []
}

function writeIndex(keys: string[]): void {
  wx.setStorageSync(INDEX_KEY, keys)
}

function indexAdd(key: string): void {
  const keys = readIndex()
  if (!keys.includes(key)) writeIndex([...keys, key])
}

function indexRemove(key: string): void {
  writeIndex(readIndex().filter((k) => k !== key))
}

export const localCas: IoState = {
  get(key: string): CasGetResult | null {
    const row = readRow(key)
    return row === null ? null : { body: row.body, etag: row.etag }
  },

  putCas(key: string, body: string, cond: CasPutCond): CasPutResult {
    const cur = readRow(key)
    if (cond.ifNoneMatch === '*' && cur !== null) return { status: 412 }
    if (cond.ifMatch !== undefined && (cur === null || cur.etag !== cond.ifMatch)) return { status: 412 }
    const etag = nextEtag()
    wx.setStorageSync(KV_PREFIX + key, { body, etag })
    indexAdd(key)
    return { status: 200, etag }
  },

  listPrefix(prefix: string): string[] {
    return readIndex().filter((k) => k.startsWith(prefix))
  },

  del(key: string): void {
    wx.removeStorageSync(KV_PREFIX + key)
    indexRemove(key)
  },
}

/** 测试/诊断：清空替身键区（不动其他 storage 键）。 */
export function localCasReset(): void {
  for (const key of readIndex()) wx.removeStorageSync(KV_PREFIX + key)
  writeIndex([])
  wx.removeStorageSync(ETAG_KEY)
}
