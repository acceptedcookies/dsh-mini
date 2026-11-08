/**
 * remoteCas —— worker/sim 五端点的 IoState 实现（T-O-5，异步签名由 IoState 放宽支持）。
 * pump 内部使用全键 `dsh-mini/{kind}/{owner}/{rest}`；线格式送 `{kind}/{rest}`，
 * openid 由服务端注入（sim 验票后取 oid，worker 取 WX 上下文）——客户端不送 openid。
 * body limit：state ≤ 256KB（AP P3 约束）。
 */

import type { CasGetResult, CasPutCond, CasPutResult, IoState } from '../nano-mini-host/types'

export interface RemoteCasOpts {
  baseUrl: string
  /** 端点前缀：worker '/v1'、sim '/sim/v1'（可配，不硬编——AP 修订点）。 */
  prefix?: string
  owner: string
  headers?: () => Promise<Record<string, string>> | Record<string, string>
  /** 测试注入：替换 wx.request/fetch 通道。 */
  post?: (url: string, headers: Record<string, string>, body: unknown) => Promise<{ status: number; body: unknown }>
}

const MAX_STATE_BYTES = 256 * 1024

function wxPost(url: string, headers: Record<string, string>, data: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method: 'POST', header: headers,
      data: data as Record<string, unknown>, timeout: 30000,
      success: (res) => resolve({ status: res.statusCode, body: res.data }),
      fail: (err) => reject(new Error(`${err.errMsg ?? 'wx.request failed'} · ${url}`)),
    })
  })
}

export function createRemoteCas(opts: RemoteCasOpts): IoState {
  const prefix = opts.prefix ?? '/v1'
  const post = opts.post ?? wxPost
  const base = opts.baseUrl.replace(/\/$/, '')

  /** 全键 → 线键：剥 `dsh-mini/{kind}/{owner}/` → `{kind}/{rest}`。 */
  const wire = (full: string): string => {
    const m = full.match(/^dsh-mini\/(state|claims|alarms|episodes)\/[^/]+\/(.+)$/)
    return m !== null ? `${m[1]}/${m[2]}` : full.replace(/^dsh-mini\//, '')
  }
  /** 线键 → 全键：`{kind}/{rest}` → `dsh-mini/{kind}/{owner}/{rest}`。 */
  const unwire = (w: string): string => {
    const m = w.match(/^(state|claims|alarms|episodes)\/(.+)$/)
    return m !== null ? `dsh-mini/${m[1]}/${opts.owner}/${m[2]}` : w
  }
  const call = async (ep: string, payload: unknown): Promise<{ status: number; body: unknown }> => {
    const h = await Promise.resolve(opts.headers?.() ?? {})
    return post(`${base}${prefix}/${ep}`, { 'content-type': 'application/json', ...h }, payload)
  }

  return {
    async get(key: string): Promise<CasGetResult | null> {
      const r = await call('state/get', { key: wire(key) })
      if (r.status === 404) return null
      if (r.status !== 200) throw new Error(`state/get ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)
      const b = r.body as { body: string; etag: string }
      return { body: b.body, etag: b.etag }
    },

    async putCas(key: string, body: string, cond: CasPutCond): Promise<CasPutResult> {
      if (body.length > MAX_STATE_BYTES) return { status: 413 }
      const r = await call('state/put-cas', { key: wire(key), body, cond })
      if (r.status === 412) return { status: 412 }
      if (r.status !== 200) throw new Error(`state/put-cas ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)
      return { status: 200, etag: (r.body as { etag: string }).etag }
    },

    async listPrefix(p: string): Promise<string[]> {
      // alarm/due 是服务端列举面；claims/state 前缀列举不属五端点（T-O-5 收窄面）
      const m = p.match(/^dsh-mini\/alarms\/[^/]+\/?$/)
      if (m === null) throw new Error(`listPrefix 仅支持 alarms 键区（收窄面）: ${p}`)
      const r = await call('alarm/due', { now: Date.now() })
      if (r.status !== 200) throw new Error(`alarm/due ${r.status}`)
      return ((r.body as { keys: string[] }).keys ?? []).map(unwire)
    },

    async del(key: string): Promise<void> {
      // alarm 行：接 /alarm/claim 原子消费端点（否则远端行永不消费——审查 P0）。
      const m = key.match(/^dsh-mini\/alarms\/[^/]+\/(.+)$/)
      if (m !== null) {
        const r = await call('alarm/claim', { key: m[1], holder: 'remote-cas' })
        // 404 = 已被并发消费者取走（at-least-once 容忍）；其余失败如实抛——不静默漏消费。
        if (r.status !== 200 && r.status !== 404) throw new Error(`alarm/claim ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)
        return
      }
      // episodes 账行 append-only 永不删除（T-O-12）——del 是合同级 no-op，如实跳过。
      if (/^dsh-mini\/episodes\//.test(key)) return
      // state/claims 行：T-O-11 扩约后真打 /v1/state/del；404 幂等容忍，其余如实抛。
      if (/^dsh-mini\/(state|claims)\/[^/]+\//.test(key)) {
        const r = await call('state/del', { key: wire(key) })
        if (r.status !== 200 && r.status !== 404) throw new Error(`state/del ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)
      }
    },
  }
}
