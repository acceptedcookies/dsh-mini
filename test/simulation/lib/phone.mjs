// live：真机自己的 wx.request 打公网。票据只留在手机里，不回传，不走隧道。
import { openApp } from './devtools.mjs'
import { capture } from './screenshots.mjs'
import { PRODUCTION_BASE } from './env.mjs'
import { fail } from './errors.mjs'

export async function openPhone() {
  const app = await openApp({ device: true })
  if (!app.device || app.device.platform === 'devtools') {
    await app.close()
    throw new Error('live 需要真机')
  }
  return app
}

export async function shot(app, evidence, name) {
  return capture(app, evidence, name, {})
}

export async function phoneSteps(app, steps) {
  // SOTER 是人体交互，不能塞进单次阻塞 eval（automator 请求超时会先到）。
  // unlock 拆三步：发起 SOTER（立即返回）→ Node 侧轮询 proof → 换票；其余步骤照旧批量跑。
  const needsUnlock = steps.some((s) => s.op === 'unlock')
  const out = []
  if (needsUnlock) {
    const started = await app.eval(`async () => {
      try { wx.cloud.init({ env: 'cloud1-d7gar8j7w419589a0' }) } catch (e) {}
      const ticket = wx.getStorageSync('dsh:sim:live-ticket') || ''
      if (ticket) return { op: 'unlock', ok: true, cached: true }
      const ch = await wx.cloud.callFunction({ name: 'unlock', data: { action: 'challenge' } }).then((r) => r.result).catch((e) => ({ error: String(e && e.errMsg || e) }))
      if (!ch || typeof ch.challenge !== 'string') return { op: 'unlock', ok: false, err: (ch && ch.error) || 'challenge' }
      globalThis.__dshSoter = null
      wx.startSoterAuthentication({
        requestAuthModes: ['fingerPrint', 'facial'],
        challenge: ch.challenge,
        authContent: '确认本人操作',
        success: (r) => { globalThis.__dshSoter = { ok: true, json: r.resultJSON, sig: r.resultJSONSignature, challenge: ch.challenge } },
        fail: (e) => { globalThis.__dshSoter = { ok: false, err: String((e && e.errMsg) || e), challenge: ch.challenge } },
      })
      return { op: 'unlock', ok: true, started: true, challenge: ch.challenge }
    }`)
    if (!started.ok) {
      out.push(fail('sim.phoneSteps.unlock', new Error(started.err || 'unlock-start-failed')).grade ?? started)
    } else if (started.cached) {
      out.push({ op: 'unlock', ok: true, cached: true })
    } else {
      let proof = null
      const deadline = Date.now() + 120000
      while (Date.now() < deadline) {
        proof = await app.eval(`() => globalThis.__dshSoter`).catch(() => null)
        if (proof) break
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (!proof || proof.ok !== true) {
        const err = (proof && proof.err) || 'soter-timeout'
        fail('sim.phoneSteps.unlock', new Error(err))
        out.push({ op: 'unlock', ok: false, err })
      } else {
        const u = await app.eval(`async () => {
          const r = await wx.cloud.callFunction({ name: 'unlock', data: { action: 'unlock', challenge: ${JSON.stringify(proof.challenge)}, result_json: ${JSON.stringify(proof.json)}, result_signature: ${JSON.stringify(proof.sig)} } }).then((x) => x.result).catch((e) => ({ error: String(e && e.errMsg || e) }))
          if (!r || typeof r.ticket !== 'string') return { op: 'unlock', ok: false, err: (r && r.error) || 'unlock' }
          // 401 判断：批量步骤若全 401，多为过期票——清 key 供下次重跑（见 errors.mjs 分级）
          wx.setStorageSync('dsh:sim:live-ticket', r.ticket)
          return { op: 'unlock', ok: true }
        }`)
        out.push(u)
      }
    }
  }
  const batch = steps.filter((s) => s.op !== 'unlock')
  if (batch.length === 0) return out
  const source = `async () => {
    const base = ${JSON.stringify(PRODUCTION_BASE)}
    const steps = ${JSON.stringify(batch)}
    const req = (url, method, data, header) => new Promise((resolve) => {
      wx.request({
        url, method, data, header, timeout: 20000,
        dataType: method === 'GET' ? 'text' : 'json',
        success: (r) => resolve({ status: r.statusCode, body: r.data, bytes: typeof r.data === 'string' ? r.data.length : (r.data && r.data.byteLength) || 0 }),
        fail: (e) => resolve({ status: 0, fail: String((e && e.errMsg) || 'fail'), body: null, bytes: 0 }),
      })
    })
    let ticket = wx.getStorageSync('dsh:sim:live-ticket') || ''
    const out = []
    for (const step of steps) {
      if (step.op === 'forget') {
        try { wx.removeStorageSync('dsh:sim:live-ticket') } catch (e) {}
        ticket = ''
        out.push({ op: 'forget', ok: true })
        continue
      }
      if (step.op === 'bio') {
        const supported = await new Promise((resolve) => wx.checkIsSupportSoterAuthentication({
          success: (r) => resolve((r.supportMode || []).length > 0), fail: () => resolve(false),
        }))
        const enrolled = await new Promise((resolve) => wx.checkIsSoterEnrolledInDevice({
          checkAuthMode: 'fingerPrint',
          success: (r) => resolve(r.isEnrolled === true), fail: () => resolve(false),
        }))
        const engine = wx.getStorageSync('dsh:mini:engine:v1') || ''
        out.push({ op: 'bio', supported, enrolled, engine: String(engine) })
        continue
      }
      if (step.op === 'sleep') {
        await new Promise((r) => setTimeout(r, step.ms || 50))
        out.push({ op: 'sleep', ok: true })
        continue
      }
      const header = { 'content-type': 'application/json' }
      if (step.auth) {
        if (!ticket) throw new Error('手机上没有票据')
        header.authorization = 'Bearer ' + ticket
      }
      const r = await req(base + step.path, step.method || 'POST', step.body || {}, header)
      const raw = typeof r.body === 'string' ? r.body : ''
      const body = r.body && typeof r.body === 'object' && !r.body.byteLength ? r.body : {}
      const text = typeof body.body === 'string' ? body.body : raw
      const keys = Array.isArray(body.keys) ? body.keys.map(String) : []
      out.push({
        op: step.op, status: r.status, fail: r.fail || '',
        error: typeof body.error === 'string' ? body.error : '',
        holder: typeof body.holder === 'string' ? body.holder : '',
        hasEtag: typeof body.etag === 'string',
        text, body_b64: typeof body.body_b64 === 'string' ? body.body_b64 : '',
        keyCount: keys.length,
        hasKey: step.wantKey ? keys.some((k) => k.includes(step.wantKey)) : false,
        removed: body.removed === true,
        hasSha: typeof body.sha256 === 'string',
        sha: typeof body.sha256 === 'string' ? body.sha256 : '',
        bytes: r.bytes || 0,
      })
    }
    return out
  }`
  const rows = out.concat(await app.eval(source))
  // 401 判断：票过期时全批 401（静默失败最坑）——给出分级错误并清票，下次重跑自愈。
  if (rows.some((r) => r.status === 401)) {
    fail('sim.phoneSteps.batch', new Error('401 with dsh:sim:live-ticket (stale ticket)'))
    await app.eval(`() => { try { wx.removeStorageSync('dsh:sim:live-ticket'); return true } catch (e) { return false } }`).catch(() => {})
  }
  return rows
}

export function step(steps, op) {
  const row = steps.find((s) => s.op === op)
  if (!row) return row
  const decoded = row.body_b64 ? Buffer.from(row.body_b64, 'base64').toString('utf8') : (row.text ?? '')
  return { ...row, decoded }
}

export function hasText(row, expect) {
  return typeof row?.decoded === 'string' && row.decoded.includes(expect)
}
