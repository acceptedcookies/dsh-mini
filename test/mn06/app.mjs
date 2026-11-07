// MN06 App 端 —— DevTools 真 App 连接 + 测试身份注入 + 既有 globalData 钩子。
//
// 复用 scripts/dev-cli/lib/ide.mjs 的单桥；不新建 automation 桥、不改 App 代码、
// 不新增 globalData 钩子。控制面 mock（challenge/SOTER/unlock），数据面真。
import { createRequire } from 'node:module'
import { createHmac, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectIde } from '../../scripts/dev-cli/lib/ide.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

// PITFALL-13：automator 广播非 JSON 帧时上游 Connection.onMessage 硬崩。
let patchedOnce = false
function patchAutomatorFrames() {
  if (patchedOnce) return
  patchedOnce = true
  const req = createRequire(import.meta.url)
  const Connection = req('miniprogram-automator/out/Connection.js').default
  const orig = Connection.prototype.onMessage
  Connection.prototype.onMessage = function onMessage(e) {
    try { return orig.call(this, e) } catch (err) {
      if (String(err?.message ?? err).includes('Unexpected token')) return
      throw err
    }
  }
  process.on('uncaughtException', (e) => {
    if (String(e?.message ?? e).includes('Unexpected token')) {
      console.warn('[mn06-app] ignored non-JSON automator frame')
      return
    }
    throw e
  })
}

/** cloud/sim 本地 LLM 代理票（dev 常量，非生产凭证）。C1 的模型输出经真实 sim→magpie；
 *  durable 数据面仍是 FRD1 测试网关。 */
function simTicket() {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const p = Buffer.from(JSON.stringify({ oid: 'sim_dev_user', scope: 'byok-proxy', jti: randomUUID(), iat: now, exp: now + 1800 })).toString('base64url')
  const s = createHmac('sha256', 'sim-ticket-secret-dev').update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${s}`
}

export async function createApp(env, oid = env.TEST_OID, { cold = false } = {}) {
  patchAutomatorFrames()
  // cold=true：走 cli-auto 新 automation 会话（appService 冷启，模块级票据缓存为空）。
  // 不复用 AUTO_PORT 的常驻会话——那会把上一轮铸的票带进来。
  const port = cold ? 9610 + Math.floor(Math.random() * 80) : Number(env.AUTO_PORT ?? 9602)
  const { mp } = await connectIde({ project: ROOT, port })

  const evaluate = (fn, arg) => mp.evaluate(fn, arg)

  const patch = await evaluate((args) => {
    const { admin, oid: testOid, base, simBase, simTicket: simTok } = args
    try {
      const mock = {
        init() {},
        // cloud 容器车道落到本地 cloud/sim 代理（真实转发 magpie）。sim 验自己的
        // dev 票；durable 数据面仍走 FRD1 测试网关（测试身份与控制面分面）。
        callContainer(o) {
          try {
            wx.request({
              url: `${simBase}${o.path}`,
              method: o.method,
              header: { 'content-type': 'application/json', authorization: `Bearer ${simTok}`, 'x-byok-provider': 'magpie' },
              data: o.data,
              timeout: 60000,
              success: (r) => o.success?.({ statusCode: r.statusCode, data: r.data }),
              fail: (e) => o.fail?.({ errMsg: String(e?.errMsg ?? e) }),
            })
          } catch (e) {
            o.fail?.({ errMsg: String(e?.message ?? e) })
          }
        },
        callFunction({ name, data }) {
          if (name === 'sweeper') return Promise.resolve({ result: { ok: true, ran: [] } })
          if (name !== 'unlock') return Promise.reject(new Error('mock unlock only'))
          if (data.action === 'challenge') return Promise.resolve({ result: { challenge: 'mn06-challenge', openid: testOid } })
          if (data.action === 'unlock') {
            return new Promise((resolve, reject) => {
              wx.request({
                url: `${base}/dev/ticket`, method: 'POST',
                header: { 'content-type': 'application/json', 'x-admin-token': admin },
                data: { oid: testOid, ttl_s: 1800 },
                success: (r) => resolve({ result: r.data }),
                fail: (e) => reject(new Error(String(e.errMsg || e))),
              })
            })
          }
          return Promise.reject(new Error('mock unknown action'))
        },
      }
      Object.defineProperty(wx, 'cloud', { configurable: true, value: mock })
      wx.setStorageSync('dsh:byok-enrollment:v1', {
        provider: 'byok', upstreamBaseUrl: 'http://u.invalid', model: 'deepseek-flash', enrolledAt: Date.now(),
      })
      wx.startSoterAuthentication = (o) => o.success({ resultJSON: '{}', resultJSONSignature: 'test' })
      wx.checkIsSupportSoterAuthentication = (o) => o.success({ supportMode: ['fingerPrint'] })
      wx.checkIsSoterEnrolledInDevice = (o) => o.success({ isEnrolled: true })
      return { patched: true }
    } catch (e) {
      return { err: String((e && e.message) || e) }
    }
  }, { admin: env.ADMIN_TOKEN, oid, base: env.DURABLE, simBase: 'http://127.0.0.1:3426', simTicket: simTicket() })

  const api = {
    mp,
    oid,
    patch,
    evaluate,
    async hasFreshTicket() {
      return evaluate(() => {
        const g = getApp().globalData
        return typeof g.__hasFreshTicket === 'function' ? g.__hasFreshTicket() : null
      })
    },
    async ensureTicket() {
      return evaluate(() => {
        const g = getApp().globalData
        if (typeof g.__ensureDurableTicket !== 'function') return Promise.resolve({ err: 'hook missing' })
        if (g.__hasFreshTicket()) return Promise.resolve({ fresh: true, minted: false })
        return g.__ensureDurableTicket().then(() => ({ fresh: g.__hasFreshTicket(), minted: true })).catch((e) => ({ err: String(e?.message ?? e) }))
      })
    },
    async diagnostics(sid) {
      return evaluate((id) => getApp().globalData.__diagnostics(id ?? undefined), sid)
    },
    async errors() {
      return evaluate(() => {
        const g = getApp().globalData
        const st = g.__errorBus?.state?.() ?? { toasts: [], pendingCount: 0 }
        return {
          toasts: (st.toasts ?? []).map((r) => ({ code: r.code, message: r.message, title: r.title })),
          pending: st.pendingCount ?? 0,
        }
      })
    },
    async setEngine(engine = 'nano-agent') {
      return evaluate((e) => {
        try { wx.setStorageSync('dsh:mini:engine:v1', e); return { ok: true } } catch (err) { return { err: String(err?.message ?? err) } }
      }, engine)
    },
    async createSession() {
      return evaluate(() => getApp().globalData.__sessionStore.create().then((id) => id ?? null).catch((e) => ({ err: String(e?.message ?? e) })))
    },
    async openSession(sid) {
      return evaluate((id) => getApp().globalData.__sessionStore.open(id).then(() => true).catch((e) => ({ err: String(e?.message ?? e) })), sid)
    },
    async prompt(text) {
      return evaluate((t) => getApp().globalData.__sessionStore.prompt(t).then(() => true).catch((e) => ({ err: String(e?.message ?? e) })), text)
    },
    async sessionState() {
      return evaluate(() => {
        const s = getApp().globalData.__sessionStore.getState()
        return {
          sending: s.sending,
          current: s.current === undefined ? null : {
            sessionId: s.current.sessionId,
            status: s.current.status,
            itemCount: s.current.items.length,
            items: s.current.items.map((i) => ({ kind: i.kind, status: i.status, text: (i.text ?? i.summary ?? '').slice(0, 120) })),
            streaming: s.streaming?.text?.length ?? 0,
          },
          error: s.error ?? null,
        }
      })
    },
    async writeVfs(path, text) {
      return evaluate((a) => {
        try {
          const sid = a.path.split('/')[2]
          getApp().globalData.__vfs.vfs.write(a.path, a.text, { sessionId: sid })
          return { ok: true }
        } catch (e) { return { err: String(e?.message ?? e) } }
      }, { path, text })
    },
    async removeVfs(path) {
      return evaluate((p) => {
        try {
          const sid = p.split('/')[2]
          return { ok: getApp().globalData.__vfs.vfs.remove(p, { sessionId: sid }) }
        } catch (e) { return { err: String(e?.message ?? e) } }
      }, path)
    },
    async readVfs(path) {
      return evaluate((p) => {
        try {
          const sid = p.split('/')[2]
          return { text: getApp().globalData.__vfs.vfs.read(p, { sessionId: sid }).text }
        } catch (e) { return { err: String(e?.message ?? e) } }
      }, path)
    },
    async pushPath(path) {
      return evaluate((p) => getApp().globalData.__vfsSyncFor().pushPath(p).then(() => ({ ok: true })).catch((e) => ({ err: String(e?.message ?? e) })), path)
    },
    async pushAll() {
      return evaluate(() => getApp().globalData.__vfsSyncFor().pushAll().then((r) => ({ pushed: r.pushed.length, failed: r.failed.length })).catch((e) => ({ err: String(e?.message ?? e) })))
    },
    async rowLocal(path) {
      return evaluate((p) => {
        const r = getApp().globalData.__vfs.vfsStore.getRow(p)
        return r === undefined ? null : { path: r.virtual_path, updated_ms: r.updated_ms, committed: r.committed }
      }, path)
    },
    async tombstone(path) {
      return evaluate((p) => {
        const t = wx.getStorageSync('dsh:mini:vfs-tombstones') || {}
        const v = t[p]
        return v === undefined ? null : { at_ms: typeof v === 'number' ? v : v.at_ms, phase: typeof v === 'number' ? 'committed' : (v.phase ?? 'committed') }
      }, path)
    },
    async diagnosticsV2(sid) {
      return evaluate((id) => getApp().globalData.__diagnostics(id ?? undefined, true), sid)
    },
    async restartMiniProgram() {
      return evaluate(() => {
        if (typeof wx.restartMiniProgram === 'function') {
          try { wx.restartMiniProgram({ path: '/pages/workspace/workspace' }); return { ok: true, via: 'restartMiniProgram' } } catch (e) { return { err: String(e?.message ?? e) } }
        }
        return { ok: false, reason: 'restartMiniProgram unavailable' }
      })
    },
    async disconnect() {
      try { await mp.disconnect() } catch { /* already gone */ }
    },
  }
  return api
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(fn, timeoutMs = 30000, stepMs = 500) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v !== undefined && v !== null && v !== false) return v
    } catch { /* transient eval/recompile */ }
    await sleep(stepMs)
  }
  return undefined
}
