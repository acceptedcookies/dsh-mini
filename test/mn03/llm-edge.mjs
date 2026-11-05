// MN03-B4 G3 实弹边缘矩阵：真 `io/llm.ts` + `error-report.ts` 源码 bundle，
// local 车道直连真 magpie（127.0.0.1:3425）。逐条断言真实故障→
// classifyError 分类→code/category/surface/diagnostics 全字段。
// 语义分级：node-source（io.llm 真源码）× magpie-live（真网关）；
// 传输替身=node fetch 仿 wx.request errMsg 形状（timeout/abort/connrefused）。
// 用法：node test/mn03/llm-edge.mjs   [MAGPIE=http://host:port]
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import zlib from 'node:zlib'

const MAGPIE = (process.env.MAGPIE ?? 'http://127.0.0.1:3425').replace(/\/$/, '')
const MODEL = process.env.MODEL ?? 'workbuddy/deepseek-v4.1-flash'
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'package.json'))
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const bundle = async (entry, plugins = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'mn03l-'))
  const ent = join(dir, 'entry.ts')
  writeFileSync(ent, entry)
  const out = await esbuild.build({ entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent', plugins })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(join(repo, 'package.json')))
  return mod.exports
}

// local 车道 stub：upstream/model 经 globalThis 动态注入（单 bundle 多用例复用）。
const devStubDir = (() => { const d = mkdtempSync(join(tmpdir(), 'devstub-')); writeFileSync(join(d, 'dev.ts'), `
export const currentRoute = () => ({ mode: 'local' })
export const loadDevConfig = () => ({ providerName: 'magpie', upstreamBaseUrl: globalThis.__MN03_UPSTREAM ?? 'http://127.0.0.1:3425', providerApiKey: '', model: globalThis.__MN03_MODEL ?? 'workbuddy/deepseek-v4.1-flash', allowedModels: globalThis.__MN03_ALLOWED ?? [], sim: { baseUrl: '' }, cloud: { envId: '', proxyUrl: '' } })
export const lastRouteError = () => undefined
`); return d })()
const devSwap = {
  name: 'dev-swap',
  setup(b) { b.onResolve({ filter: /fx\/dev$/ }, () => ({ path: join(devStubDir, 'dev.ts') })) },
}

const { createIoLlm } = await bundle(`import { createIoLlm } from '${repo}/services/nano-mini-host/io/llm'; export { createIoLlm }`, [devSwap])
const { classifyError, errorBus } = await bundle(`import { classifyError, errorBus } from '${repo}/services/error-report'; export { classifyError, errorBus }`)
// MODEL 环境变量 → 生效模型槽（activeModel=storage.getModel∩白名单——cfg.model
// 不参选；配额隔离时 MODEL=workbuddy/deepseek-v4-pro 可绕上游单模型 429）。
if (process.env.MODEL !== undefined) {
  wx.setStorageSync('dsh:model:v2', process.env.MODEL)
  globalThis.__MN03_ALLOWED = [process.env.MODEL]
}

/** node fetch → wx.request 语义替身：fail 产出 wx errMsg 形状；timeout/abort 可控。 */
const fetchRequest = (opts = {}) => async (url, headers, data) => {
  const ctl = new AbortController()
  const timer = opts.timeoutMs !== undefined ? setTimeout(() => ctl.abort(new Error('timeout')), opts.timeoutMs) : undefined
  if (opts.preAbort === true) ctl.abort(new Error('abort'))
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data), signal: ctl.signal })
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (ctl.signal.aborted) throw new Error(`request:fail ${opts.preAbort === true ? 'abort' : 'timeout'}`)
    throw new Error(`request:fail ${msg}`) // wx errMsg 形状：ECONNREFUSED/ENOTFOUND 等进 detail
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const llm = createIoLlm({ request: fetchRequest() })
const attempt = async (fn) => { try { return { out: await fn() } } catch (e) { return { err: e } } }

// ── L1 基线：真 magpie 成功轮 ─────────────────────────────────────
globalThis.__MN03_UPSTREAM = MAGPIE
globalThis.__MN03_MODEL = MODEL
{
  const { out, err } = await attempt(() => llm([{ role: 'user', content: 'Reply with the single word: pong' }]))
  check('L1:真 magpie 成功轮（text+usage 齐）', err === undefined && typeof out?.text === 'string' && out.text.length > 0 && typeof out.usage?.inputTokens === 'number', err === undefined ? `reply=${JSON.stringify(out.text).slice(0, 80)} usage=${JSON.stringify(out.usage)}` : String(err))
}

// ── L2 死端口：网络不可达 → network-error toast ─────────────────────
{
  globalThis.__MN03_UPSTREAM = 'http://127.0.0.1:9' // discard 端口——真实 ECONNREFUSED
  const { err } = await attempt(() => llm([{ role: 'user', content: 'hi' }]))
  const r = classifyError(err)
  check('L2:ECONNREFUSED→network-error toast warn', err !== undefined && r.code === 'network-error' && r.category === 'network' && r.surface === 'toast' && r.severity === 'warn' && r.diagnostics.retryable === true, `code=${r.code} msg=${r.message.slice(0, 80)}`)
  errorBus.clear()
  errorBus.report(r)
  check('L2b:report→toast 面落位', errorBus.state().toasts.length === 1 && errorBus.state().modal === undefined)
  globalThis.__MN03_UPSTREAM = MAGPIE
}

// ── L3 坏模型：magpie 400 → upstream-4xx modal ─────────────────────
// 生效模型=storage.getModel()∩白名单（activeModel 合同）——注入白名单+存储选择
// 才能让坏模型真到上游。
{
  globalThis.__MN03_ALLOWED = ['workbuddy/no-such-model']
  wx.setStorageSync('dsh:model:v2', 'workbuddy/no-such-model')
  const { err } = await attempt(() => llm([{ role: 'user', content: 'hi' }]))
  const r = classifyError(err, { op: 'prompt', lane: 'kernel', sessionId: 'mn03-l3' })
  check('L3:坏模型 400→upstream-400 modal + status/ctx', err !== undefined && r.code === 'upstream-400' && r.surface === 'modal' && r.diagnostics.status === 400 && r.diagnostics.retryable === false && r.diagnostics.sessionId === 'mn03-l3', `code=${r.code} status=${r.diagnostics.status} msg=${r.message.slice(0, 90)}`)
  errorBus.clear()
  errorBus.report(r)
  check('L3b:report→modal 面落位', errorBus.state().modal?.code === 'upstream-400' && errorBus.state().toasts.length === 0)
  globalThis.__MN03_ALLOWED = []
  wx.removeStorageSync('dsh:model:v2')
  // MODEL env 注入在 L3 清理后被抹——重放以覆盖 L4..L10（normalizeModel
  // 无选择回落白名单首项/默认模型，env 意图须持续生效）。
  if (process.env.MODEL !== undefined) {
    wx.setStorageSync('dsh:model:v2', process.env.MODEL)
    globalThis.__MN03_ALLOWED = [process.env.MODEL]
  }
}

// ── L4 坏请求：空 messages → magpie 4xx → upstream-4xx modal ──────
{
  const { err } = await attempt(() => llm([]))
  const r = classifyError(err)
  check('L4:空 messages→upstream-4xx modal', err !== undefined && r.category === 'upstream' && r.surface === 'modal' && (r.diagnostics.status ?? 0) >= 400 && (r.diagnostics.status ?? 0) < 500, `code=${r.code} status=${r.diagnostics.status}`)
}

// ── L5 超时：传输替身 50ms abort → network-timeout toast ──────────
// （wx.request timeout → errMsg 'request:fail timeout'；node fetch 无内建
//   timeout，AbortController+errMsg 仿形——传输语义如实标注替身。）
{
  const slow = createIoLlm({ request: fetchRequest({ timeoutMs: 50 }) })
  // 慢端点：magpie 生成本身>50ms——真路径真超时
  const { err } = await attempt(() => slow([{ role: 'user', content: 'Write a long essay about the ocean.' }]))
  const r = classifyError(err)
  check('L5:timeout→network-timeout toast', err !== undefined && r.code === 'network-timeout' && r.surface === 'toast', `code=${r.code} msg=${r.message.slice(0, 60)}`)
}

// ── L6 200 坏 body：空 choices / 非 JSON 体 → 优雅 null 不炸 ────────
{
  const empty = createIoLlm({ request: async () => ({ status: 200, body: {} }) })
  const o1 = await attempt(() => empty([{ role: 'user', content: 'hi' }]))
  check('L6a:choices 缺席→{text:null} 优雅', o1.err === undefined && o1.out.text === null && o1.out.toolCalls === undefined)
  const html = createIoLlm({ request: async () => ({ status: 200, body: '<html>nginx bad gateway</html>' }) })
  const o2 = await attempt(() => html([{ role: 'user', content: 'hi' }]))
  check('L6b:非 JSON 体→{text:null} 优雅', o2.err === undefined && o2.out.text === null)
}

// ── L7 图像 data: 输入 → 真视觉应答 ────────────────────────────────
{
  const png = (() => {
    const crc32 = (buf) => { let c, t = crc32.t; if (!t) { t = crc32.t = new Int32Array(256); for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } } c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]) }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(96, 0); ihdr.writeUInt32BE(96, 4); ihdr[8] = 8; ihdr[9] = 2
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(96 * 3)])
    const raw = Buffer.alloc(96 * (1 + 96 * 3))
    for (let y = 0; y < 96; y++) { row.copy(raw, y * (1 + 96 * 3)); for (let x = 0; x < 96; x++) { const o = y * (1 + 96 * 3) + 1 + x * 3; raw[o] = 220; raw[o + 1] = 30; raw[o + 2] = 30 } }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  })()
  const { out, err } = await attempt(() => llm([{ role: 'user', content: [
    { kind: 'image_url', url: `data:image/png;base64,${png.toString('base64')}` },
    { kind: 'text', text: 'What single color fills this square? Answer with one word.' },
  ] }]))
  check('L7:data: 图像→视觉应答 red', err === undefined && typeof out?.text === 'string' && /red/i.test(out.text), err === undefined ? `reply=${JSON.stringify(out.text).slice(0, 80)}` : String(err))
}

// ── L8 超大载荷：1.5MB 单条 → 成功或如实分类（不 wedge）─────────────
{
  const big = 'x'.repeat(1536 * 1024)
  const { out, err } = await attempt(() => llm([{ role: 'user', content: big }]))
  if (err === undefined) {
    check('L8:1.5MB 载荷→上游接受（无 wedge）', out !== undefined, `text=${String(out?.text).slice(0, 40)}`)
  } else {
    const r = classifyError(err)
    check('L8:1.5MB 载荷→拒答如实分类（status 落账）', r.diagnostics.status !== undefined || r.code === 'network-error', `code=${r.code} status=${r.diagnostics.status} msg=${r.message.slice(0, 80)}`)
  }
}

// ── L9 abort：预中止 → cancelled silent（用户停止=非故障语义）────────
{
  const aborted = createIoLlm({ request: fetchRequest({ preAbort: true }) })
  const { err } = await attempt(() => aborted([{ role: 'user', content: 'hi' }]))
  const r = classifyError(err)
  check('L9:abort→cancelled silent（非故障）', err !== undefined && r.code === 'cancelled' && r.surface === 'silent' && r.severity === 'info', `code=${r.code}`)
  errorBus.clear()
  errorBus.report(r)
  check('L9b:cancelled 入 bus 不弹', errorBus.state().toasts.length === 0 && errorBus.state().modal === undefined)
}

// ── L10 缺 upstreamBaseUrl → route-config modal（配置错误面）─────────
{
  globalThis.__MN03_UPSTREAM = ''
  const { err } = await attempt(() => llm([{ role: 'user', content: 'hi' }]))
  const r = classifyError(err)
  check('L10:缺 upstreamBaseUrl→route-config modal', err !== undefined && r.code === 'route-config' && r.surface === 'modal' && r.diagnostics.retryable === false, `code=${r.code} msg=${r.message.slice(0, 70)}`)
  globalThis.__MN03_UPSTREAM = MAGPIE
}

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
