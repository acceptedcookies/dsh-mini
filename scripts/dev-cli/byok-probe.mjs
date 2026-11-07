// byok-probe —— 真机 BYOK 轮次全链取证（legacy，已收编 ProbeDriver）：
// wx.request + wx.cloud.callFunction/callContainer 三钩齐挂
// （BYOK 链走 wx.cloud 不经 request，单钩 request 必盲）。
// 用法: node scripts/dev-cli/byok-probe.mjs [--port 9602] [--prompt "文本"]
import { ProbeDriver } from './lib/probe.mjs'

const portIdx = process.argv.indexOf('--port')
const port = portIdx > -1 ? Number(process.argv[portIdx + 1]) : 9602
const pIdx = process.argv.indexOf('--prompt')
const PROMPT = pIdx > -1 ? process.argv[pIdx + 1] : '用 vfs 写一个 hello.txt，内容是 hello world'

const d = await ProbeDriver.open({ via: 'automator', automatorOpts: { port } })
const mp = d.mp
const info = await mp.evaluate(() => wx.getDeviceInfo())
console.log('peer:', info.brand, info.model, info.system)
if (info.brand === 'devtools') { console.log('ABORT: 对端是模拟器不是真机'); process.exit(2) }

const surface = await mp.evaluate(() => ({
  cloud: typeof wx.cloud,
  callFunction: typeof (wx.cloud || {}).callFunction,
  callContainer: typeof (wx.cloud || {}).callContainer,
  soter: typeof wx.startSoterAuthentication,
}))
console.log('cloud-surface:', JSON.stringify(surface))

await mp.evaluate(() => {
  const g = globalThis
  g.__cap = { reqs: [], resps: [], cf: [], cc: [], soter: [], errs: [], sendErr: null }
  const str = (x) => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x) } catch { return '[?]' } }
  const origReq = wx.request.bind(wx)
  wx.request = (o) => {
    g.__cap.reqs.push({ url: o.url, m: o.method })
    const oc = o.complete
    o.complete = (r) => { g.__cap.resps.push({ url: o.url, s: r.statusCode, b: str(r.data).slice(0, 400) }); oc && oc(r) }
    return origReq(o)
  }
  if (wx.cloud) {
    if (typeof wx.cloud.callFunction === 'function') {
      const ocf = wx.cloud.callFunction.bind(wx.cloud)
      wx.cloud.callFunction = (o) => {
        g.__cap.cf.push({ name: o.name, action: o.data && o.data.action, t: Date.now() })
        return ocf(o).then(
          (r) => { g.__cap.cf.push({ name: o.name, ok: true, r: str(r.result).slice(0, 300) }); return r },
          (e) => { g.__cap.cf.push({ name: o.name, ok: false, e: str(e).slice(0, 300) }); throw e },
        )
      }
    }
    if (typeof wx.cloud.callContainer === 'function') {
      const occ = wx.cloud.callContainer.bind(wx.cloud)
      wx.cloud.callContainer = (o) => {
        g.__cap.cc.push({ path: o.path, m: o.method, t: Date.now() })
        const oc2 = o.complete
        o.complete = (r) => { g.__cap.cc.push({ path: o.path, s: r.statusCode, b: str(r.data).slice(0, 400) }); oc2 && oc2(r) }
        return occ(o)
      }
    }
  }
  if (typeof wx.startSoterAuthentication === 'function') {
    const os = wx.startSoterAuthentication.bind(wx)
    wx.startSoterAuthentication = (o) => {
      g.__cap.soter.push({ phase: 'invoke', modes: o.requestAuthModes })
      const oc3 = o.complete
      o.complete = (r) => { g.__cap.soter.push({ phase: 'complete', ok: !r.errMsg || /ok/.test(r.errMsg), msg: r.errMsg }); oc3 && oc3(r) }
      return os(o)
    }
  }
  const oe = console.error.bind(console)
  console.error = (...a) => { g.__cap.errs.push(a.map(str).join(' ').slice(0, 300)); oe(...a) }
})
console.log('probes armed')

await mp.evaluate((prompt) => {
  const p = getCurrentPages()[0]
  p.onComposerInput({ detail: { value: prompt } })
  const r = p.send()
  if (r && r.catch) r.catch((e) => { globalThis.__cap.sendErr = String(e.stack || e).slice(0, 500) })
}, PROMPT)
console.log('sent:', PROMPT)

let done = false
for (let t = 0; t < 90 && !done; t++) {
  await new Promise((r) => setTimeout(r, 2000))
  const s = await mp.evaluate(() => {
    const p = getCurrentPages()[0]
    const c = globalThis.__cap
    const sess = (p.data.state.sessions || []).find((x) => x.id === p.data.currentId)
    return {
      sess: sess && sess.status,
      items: (p.data.displayItems || []).map((i) => i.kind),
      reqs: c.reqs.length, cf: c.cf.length, cc: c.cc.length,
      soter: c.soter.length, sendErr: c.sendErr !== null,
    }
  }).catch((e) => ({ pollErr: String(e).slice(0, 100) }))
  if (t % 5 === 0 || s.soter > 0) console.log(`t${t * 2}s`, JSON.stringify(s).slice(0, 320))
  done = s.sendErr === true || s.sess === 'error' || (s.sess === 'idle' && s.items.length > 1 && t > 5)
}

const cap = await mp.evaluate(() => globalThis.__cap)
const p2 = await mp.evaluate(() => {
  const p = getCurrentPages()[0]
  const sess = (p.data.state.sessions || []).find((x) => x.id === p.data.currentId)
  return { status: sess && sess.status, items: (p.data.displayItems || []).map((i) => ({ k: i.kind, t: String(i.text || '').slice(0, 120), st: i.status })) }
})
console.log('=== SESSION ===', JSON.stringify(p2, null, 1).slice(0, 2000))
console.log('=== CALLFUNCTION ===', JSON.stringify(cap.cf, null, 1))
console.log('=== CALLCONTAINER ===', JSON.stringify(cap.cc, null, 1))
console.log('=== SOTER ===', JSON.stringify(cap.soter, null, 1))
console.log('=== REQS(llm-ish) ===', JSON.stringify(cap.reqs.filter((r) => !/state|alarm|vfs/.test(r.url)), null, 1))
console.log('=== RESPS(llm-ish) ===', JSON.stringify(cap.resps.filter((r) => !/state|alarm|vfs/.test(r.url)), null, 1))
console.log('=== ERRS ===', JSON.stringify(cap.errs.slice(0, 12), null, 1))
console.log('=== SENDERR ===', cap.sendErr)
await d.close()
