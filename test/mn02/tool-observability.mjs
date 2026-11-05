// MN02-B6 G5 实验：tool-call 矩阵 + delta 时序 + transcript POD1 上行 + durable 指针 + 观测。
// A) tool 矩阵：真 io/tool.ts + 真 vfs（wx-shim fs）——5 工具成功面 + 4 错误面。
// B) delta 时序：真 KernelMiniRuntime + 真 kernel.js（globalThis.__dshKernelBundle 种子）
//    + scripted io/llm（dep-swap 注入面）——事件序/timestamp/attemptId/settle-after-delta。
// C) transcript：runtime 实产 items → 真 transcript.ts → dep-swap 真 RemoteVfs → POD1
//    行回读字节级一致 + wx.storage durable 指针 + 水位幂等（二次推 0）。
// 用法：TICKET=$(dev-ticket) node test/mn02/tool-observability.mjs
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const BASE = (process.env.BASE ?? 'https://dsh-mini.haimang.com.cn').replace(/\/$/, '')
const TICKET = process.env.TICKET ?? ''
if (!TICKET) { console.error('TICKET env required'); process.exit(2) }

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const bundle = async (entry, plugins = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'mn02t-'))
  const ent = join(dir, 'entry.ts')
  writeFileSync(ent, entry)
  const out = await esbuild.build({ entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent', plugins })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(join(repo, 'package.json')))
  return mod.exports
}
const stub = (name, src) => { const d = mkdtempSync(join(tmpdir(), `st-${name}-`)); writeFileSync(join(d, `${name}.ts`), src); return join(d, `${name}.ts`) }
const swap = (filter, path) => ({ name: `swap-${filter}`, setup: (b) => b.onResolve({ filter: new RegExp(filter) }, () => ({ path })) })

const devLocal = stub('dev', `export const currentRoute = () => ({ mode: 'local' }); export const loadDevConfig = () => undefined`)
const llmStub = stub('llm', `
export const createIoLlm = () => async (messages) => {
  const s = globalThis.__llmScript
  s.calls = (s.calls ?? 0) + 1
  const step = s.script[s.calls - 1] ?? { text: 'end-of-script' }
  return step
}
`)

// ── A: tool 矩阵（真 io/tool.ts → 真 vfs → shim fs）───────────────────
{
  const { createIoTool } = await bundle(`import { createIoTool } from '${repo}/services/nano-mini-host/io/tool'; export { createIoTool }`)
  const SID = `mn02tl-${Date.now().toString(36)}`
  const tool = createIoTool(SID)
  const run = (n, a) => tool(n, a)
  const j = (r) => { try { return JSON.parse(r.text ?? r.message ?? '{}') } catch { return {} } }
  let r = await run('file_write', { path: `/data/${SID}/note.md`, content: '# tool-matrix' })
  check('A:file_write inline-text', r.kind === 'inline-text' && r.provenance?.context_property === 'tool-result', r.kind)
  r = await run('file_read', { path: `/data/${SID}/note.md` })
  check('A:file_read round-trip', r.kind === 'inline-text' && j(r).text === '# tool-matrix' && r.provenance?.context_layer === 'file_read', j(r).text)
  r = await run('file_list', { path: `/data/${SID}` })
  check('A:file_list entry', r.kind === 'inline-text' && JSON.stringify(j(r)).includes('note.md'))
  r = await run('file_stat', { path: `/data/${SID}/note.md` })
  check('A:file_stat shape', r.kind === 'inline-text' && (j(r).kind === 'file' || j(r).size_bytes > 0), JSON.stringify(j(r)).slice(0, 80))
  r = await run('file_write', { path: '/mnt/ro.txt', content: 'x' })
  check('A:/mnt write → error result', r.kind === 'error' && r.error?.code === 'read-only-path', r.error?.code)
  r = await run('file_write', { path: '/data/other-session/x', content: 'x' })
  check('A:cross-session → error', r.kind === 'error' && r.error?.code === 'unsafe-workspace-path', r.error?.code)
  r = await run('file_read', { path: `/data/${SID}/nonexistent` })
  check('A:read missing → error', r.kind === 'error', r.error?.code)
  r = await run('bogus_tool', { path: '/data/x' })
  check('A:unknown tool → error', r.kind === 'error', r.error?.code)
  r = await run('file_remove', { path: `/data/${SID}/note.md` })
  check('A:file_remove', r.kind === 'inline-text' && j(r).removed === true)
}

// ── B: delta 时序（真 runtime + 真 kernel + scripted llm）─────────────
{
  globalThis.__dshKernelBundle = { kernel: (() => { const k = createRequire(join(repo, 'package.json'))(join(repo, 'subpkg/kernel/kernel.js')); return k.kernel ?? k })() }
  const { kernelRuntime } = await bundle(
    `import { kernelRuntime } from '${repo}/services/nano-mini-host/runtime'; export { kernelRuntime }`,
    [swap('fx\\/dev$', devLocal), swap('io\\/llm$', llmStub)],
  )
  const events = []
  kernelRuntime.subscribe((e) => events.push({ ...e, ts: Date.now() }))
  const s = kernelRuntime.create()
  const SID = s.id
  const idleCount = () => events.filter((e) => e.type === 'status' && e.state === 'idle').length
  const waitNewIdle = async (before) => { const d = Date.now() + 15000; while (Date.now() < d) { if (idleCount() > before) return; await new Promise((r) => setTimeout(r, 100)) } throw new Error('idle timeout') }
  globalThis.__llmScript = { script: [
    { toolCalls: [{ id: 'c1', name: 'file_write', input: { path: `/data/${SID}/turn1.txt`, content: 't1' } }] },
    { text: 'turn-one-reply' },
  ] }
  await kernelRuntime.prompt(SID, 'first')
  // drive 是 fire-and-forget（void this.drive）——等本轮新 idle（旧 idle 不算）
  await waitNewIdle(0)
  globalThis.__llmScript = { script: [{ text: 'turn-two-reply' }] }
  await kernelRuntime.prompt(SID, 'second')
  await waitNewIdle(1)

  const deltas = events.filter((e) => e.type === 'assistant.delta')
  const settles = events.filter((e) => e.type === 'assistant.settle')
  const statuses = events.filter((e) => e.type === 'status')
  const toolCalls = events.filter((e) => e.type === 'item.append' && e.item?.kind === 'tool_call')
  const toolResults = events.filter((e) => e.type === 'item.append' && e.item?.kind === 'tool_result')
  check('B:turn1 tool 链事件', toolCalls.length >= 1 && toolResults.length >= 1, `tool_call=${toolCalls.length} tool_result=${toolResults.length}`)
  check('B:delta 两次 attempt 各 index=1', deltas.length === 2 && deltas[0].index === 1 && deltas[1].index === 1 && deltas[0].attemptId !== deltas[1].attemptId, JSON.stringify(deltas.map((d) => [d.attemptId.slice(-4), d.index])))
  check('B:delta 文本=llm 输出', deltas[0].text === 'turn-one-reply' && deltas[1].text === 'turn-two-reply', deltas.map((d) => d.text).join('|'))
  const firstSettleIdx = events.findIndex((e) => e === settles[0])
  const lastDeltaIdx = events.findIndex((e) => e === deltas[0])
  check('B:delta→settle 时序', lastDeltaIdx !== -1 && firstSettleIdx > lastDeltaIdx, `delta@${lastDeltaIdx} settle@${firstSettleIdx}`)
  const tsSeq = events.map((e) => e.ts)
  check('B:事件 timestamp 单调不减', tsSeq.every((t, i) => i === 0 || t >= tsSeq[i - 1]), `events=${events.length}`)
  check('B:running→idle 状态机', statuses.some((e) => e.state === 'running') && statuses[statuses.length - 1].state === 'idle')
  globalThis.__capturedItems = events.filter((e) => e.type === 'item.append').map((e) => e.item)
  globalThis.__capturedSid = SID
}

// ── C: transcript 上行 + durable 指针 + 水位幂等 ──────────────────────
{
  const provStub = stub('provider', `
import { createRemoteVfs } from '${repo}/services/vfs/remote'
const post = async (url, headers, body) => {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const remote = createRemoteVfs({ baseUrl: '${BASE}', headers: () => ({ authorization: 'Bearer ${TICKET}' }), post })
export const vfsRemoteFor = () => remote
`)
  const { syncTranscript, readSessionPointer } = await bundle(
    `import { syncTranscript, readSessionPointer } from '${repo}/services/nano-mini-host/transcript'; export { syncTranscript, readSessionPointer }`,
    [swap('state\\/provider$', provStub)],
  )
  const SID = globalThis.__capturedSid
  const items = globalThis.__capturedItems
  check('C:runtime items 非空', items.length >= 4, `items=${items.length} (user/tool_call/tool_result/assistant)`)
  const rep = await syncTranscript(SID, items, { model: 'workbuddy/deepseek-v4.1-flash' })
  check('C:transcript 上行', rep !== null && rep.pushed === items.length && rep.lastSeq === items[items.length - 1].seq, JSON.stringify(rep))
  const ptr = readSessionPointer(SID)
  check('C:durable 指针行', ptr !== undefined && ptr.last_seq === items[items.length - 1].seq && ptr.remote_prefix === `transcripts/${SID}/`, JSON.stringify(ptr))
  const rep2 = await syncTranscript(SID, items, {})
  check('C:水位幂等（再推 0 行）', rep2 !== null && rep2.pushed === 0 && rep2.skipped === items.length, JSON.stringify(rep2))
  // 远端行回读字节级断言（不走 client——直打 API）
  const post = async (ep, body) => { const r = await fetch(`${BASE}/v1/${ep}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TICKET}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }
  const last = items[items.length - 1]
  const row = await post('vfs/get', { key: `vfs/transcripts/${SID}/${String(last.seq).padStart(6, '0')}.json` })
  const back = row.status === 200 ? JSON.parse(Buffer.from(row.body.body_b64, 'base64').toString()) : null
  check('C:远端行字节级一致', back !== null && back.seq === last.seq && back.kind === last.kind, `seq=${back?.seq} kind=${back?.kind}`)
  const meta = await post('vfs/get', { key: `vfs/transcripts/${SID}/_meta.json` })
  check('C:_meta.json 在远端', meta.status === 200, `status=${meta.status}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
