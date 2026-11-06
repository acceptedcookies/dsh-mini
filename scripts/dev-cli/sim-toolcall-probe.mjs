// sim-toolcall-probe.mjs · 模拟器 tool-call 全链验证
// 证: io.llm FILE_TOOL_ENVELOPE 上 wire → 模型回 tool_calls → io.tool 执行 VFS → 终态 idle
import automator from 'miniprogram-automator'

const ENDPOINT = process.env.MP_WS || 'ws://localhost:9602'
const HARD = setTimeout(() => { console.log(JSON.stringify({ result: 'fail', machineReason: 'hard-timeout' })); process.exit(2) }, 150000)
HARD.unref()

const mp = await automator.connect({ wsEndpoint: ENDPOINT, timeout: 15000 })

// 1) wx.request + console 全钩
const hooks = await mp.evaluate(() => {
  const g = globalThis
  g.__probe = { reqs: [], resps: [], consoleErrs: [] }
  const req = wx.request.bind(wx)
  wx.request = (o) => {
    const isLlm = o.url && /chat\/completions|3425|3426/.test(String(o.url))
    if (isLlm) g.__probe.reqs.push({ url: o.url, method: o.method, body: typeof o.data === 'string' ? o.data : JSON.stringify(o.data) })
    const wrapped = {
      ...o,
      success: (r) => { if (isLlm) g.__probe.resps.push({ url: o.url, status: r.statusCode, body: typeof r.data === 'string' ? r.data.slice(0, 4000) : JSON.stringify(r.data).slice(0, 4000) }); o.success && o.success(r) },
      fail: (e) => { if (isLlm) g.__probe.resps.push({ url: o.url, error: String(e && e.errMsg || e).slice(0, 300) }); o.fail && o.fail(e) },
    }
    return req(wrapped)
  }
  for (const k of ['error', 'warn']) {
    const orig = console[k].bind(console)
    console[k] = (...a) => { try { g.__probe.consoleErrs.push(k + ':' + a.map(String).join(' ').slice(0, 300)) } catch (_) {} ; return orig(...a) }
  }
  return 'hooks-ok'
})
console.log('HOOKS', JSON.stringify(hooks))

// 2) 引擎/会话前态
const pre = await mp.evaluate(() => {
  const pages = getCurrentPages()
  const ws = pages[pages.length - 1]
  return { engine: wx.getStorageSync('dsh:mini:engine:v1'), route: wx.getStorageSync('dsh:mini:route:v1'), page: ws.route, status: ws.data.state && ws.data.state.current && ws.data.state.current.status, items: (ws.data.displayItems || []).length }
})
console.log('PRE', JSON.stringify(pre))

// 3) 发 file_list 轮
const send = await mp.evaluate(() => {
  const pages = getCurrentPages()
  const ws = pages[pages.length - 1]
  ws.setData({ input: '请调用 file_list 工具列出 vfs 根目录所有文件' })
  try { ws.send(); return { sent: true } } catch (e) { return { sendErr: String(e).slice(0, 200) } }
})
console.log('SEND', JSON.stringify(send))

// 4) 轮询终态 + 取证
let final = null
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2500))
  const st = await mp.evaluate(() => {
    const g = globalThis
    const pages = getCurrentPages()
    const ws = pages[pages.length - 1]
    const items = (ws.data.displayItems || [])
    return {
      status: ws.data.state && ws.data.state.current && ws.data.state.current.status,
      items: items.length,
      kinds: items.slice(-6).map(m => ({ k: m.kind, tool: m.tool, st: m.status, t: String(m.text || m.summary || '').slice(0, 100) })),
      reqCount: g.__probe.reqs.length,
      toolsOnWire: g.__probe.reqs.map(r => /"tools"\s*:\s*\[/.test(r.body || '')),
      errs: g.__probe.consoleErrs.slice(0, 10),
    }
  }).catch(e => ({ err: String(e).slice(0, 150) }))
  console.log('T' + Math.round(i * 2.5) + 's', JSON.stringify(st))
  if (st.err || st.status === 'idle' || st.status === 'error') { final = st; break }
  final = st
}

// 5) wire 证据
const wire = await mp.evaluate(() => (globalThis.__probe.reqs || []).map(r => ({
  url: r.url,
  hasTools: /"tools"\s*:\s*\[/.test(r.body || ''),
  toolNames: (r.body.match(/"name"\s*:\s*"file_\w+"/g) || []),
  msgCount: (r.body.match(/"role"\s*:/g) || []).length,
  hasToolCallMsgs: /"tool_calls"|"tool_call_id"/.test(r.body || ''),
  bodyLen: (r.body || '').length,
})))
const resp = await mp.evaluate(() => (globalThis.__probe.resps || []).map(r => ({ url: r.url, status: r.status, err: r.error, toolCallsInResp: /"tool_calls"/.test(r.body || ''), respLen: (r.body || '').length })))
console.log('WIRE', JSON.stringify(wire))
console.log('RESP', JSON.stringify(resp))

await mp.disconnect()
const sawToolCall = final && final.kinds && final.kinds.some(k => k.k === 'tool_call')
const sawToolResult = final && final.kinds && final.kinds.some(k => k.k === 'tool_result')
console.log(JSON.stringify({
  result: (sawToolCall && sawToolResult && final.status === 'idle') ? 'pass' : 'degraded',
  sawToolCall, sawToolResult, final, wire, resp,
}))
process.exit(0)
