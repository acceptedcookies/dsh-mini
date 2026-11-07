// live：真机自己的 wx.request 打公网。票据只留在手机里，不回传，不走隧道。
import { openApp } from './devtools.mjs'
import { capture } from './screenshots.mjs'
import { PRODUCTION_BASE } from './env.mjs'

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
  const source = `async () => {
    const base = ${JSON.stringify(PRODUCTION_BASE)}
    const steps = ${JSON.stringify(steps)}
    const req = (url, method, data, header) => new Promise((resolve) => {
      wx.request({
        url, method, data, header, timeout: 20000,
        success: (r) => resolve({ status: r.statusCode, body: r.data, bytes: typeof r.data === 'string' ? r.data.length : (r.data && r.data.byteLength) || 0 }),
        fail: (e) => resolve({ status: 0, fail: String((e && e.errMsg) || 'fail'), body: null, bytes: 0 }),
      })
    })
    const cloud = (data) => wx.cloud.callFunction({ name: 'unlock', data }).then((r) => r.result)
    let ticket = wx.getStorageSync('dsh:sim:live-ticket') || ''
    const out = []
    for (const step of steps) {
      if (step.op === 'unlock') {
        if (!ticket) {
          const ch = await cloud({ action: 'challenge' })
          if (!ch || typeof ch.challenge !== 'string') throw new Error((ch && ch.error) || 'challenge')
          const proof = await new Promise((resolve, reject) => wx.startSoterAuthentication({
            requestAuthModes: ['fingerPrint', 'facial'],
            challenge: ch.challenge,
            authContent: '确认本人操作',
            success: resolve,
            fail: (e) => reject(new Error((e && e.errMsg) || 'soter')),
          }))
          const u = await cloud({
            action: 'unlock', challenge: ch.challenge,
            result_json: proof.resultJSON, result_signature: proof.resultJSONSignature,
          })
          if (!u || typeof u.ticket !== 'string') throw new Error((u && u.error) || 'unlock')
          ticket = u.ticket
          wx.setStorageSync('dsh:sim:live-ticket', ticket)
        }
        out.push({ op: 'unlock', ok: true })
        continue
      }
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
      const body = r.body && typeof r.body === 'object' && !r.body.byteLength ? r.body : {}
      const text = typeof body.body === 'string' ? body.body : ''
      out.push({
        op: step.op, status: r.status, fail: r.fail || '',
        error: typeof body.error === 'string' ? body.error : '',
        holder: typeof body.holder === 'string' ? body.holder : '',
        hasEtag: typeof body.etag === 'string',
        text, body_b64: typeof body.body_b64 === 'string' ? body.body_b64 : '',
        keyCount: Array.isArray(body.keys) ? body.keys.length : -1,
        removed: body.removed === true,
        hasSha: typeof body.sha256 === 'string',
        sha: typeof body.sha256 === 'string' ? body.sha256 : '',
        bytes: r.bytes || 0,
      })
    }
    return out
  }`
  return app.eval(source)
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
