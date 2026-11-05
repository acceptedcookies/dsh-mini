// MN02-B7 G6 实验：边缘矩阵 + GSTH-like transcript 场景。
// 不重复已证面（cold-state 的 kill/fence/alarm、mp-remote 的五根/挂载），
// 专打未覆盖边缘：腐行、超限、并发泵、取消、unicode/二进制/大文件、
// 增量转录、tenant-handoff（同 oid 新设备 transcript 可携带性）。
// 用法：TICKET=$(dev-ticket) node test/mn02/edge-matrix.mjs
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
const require = createRequire(join(repo, 'package.json'))
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const kernel = (() => { const b = require(join(repo, 'cloud/functions/sweeper/vendor/kernel.cjs')); return b.kernel ?? b })()
const host = require(join(repo, 'cloud/functions/sweeper/vendor/host.cjs'))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const bundle = async (entry, plugins = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'mn02e-'))
  const ent = join(dir, 'entry.ts')
  writeFileSync(ent, entry)
  const out = await esbuild.build({ entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent', plugins })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(join(repo, 'package.json')))
  return mod.exports
}
const stub = (name, src) => { const d = mkdtempSync(join(tmpdir(), `es-${name}-`)); writeFileSync(join(d, `${name}.ts`), src); return join(d, `${name}.ts`) }
const swap = (filter, path) => ({ name: `sw-${filter}`, setup: (b) => b.onResolve({ filter: new RegExp(filter) }, () => ({ path })) })
const post = async (ep, body) => { const r = await fetch(`${BASE}/v1/${ep}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TICKET}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }

const { createRemoteCas } = await bundle(`import { createRemoteCas } from '${repo}/services/state/remote-cas'; export { createRemoteCas }`)
const mkCas = (owner) => createRemoteCas({ baseUrl: BASE, owner, headers: () => ({ authorization: `Bearer ${TICKET}` }), post: async (url, headers, body) => { const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } } })
const mkIo = (cas, script = {}) => {
  let execs = 0
  return { io: {
    state: cas,
    llm: async () => { script.n = (script.n ?? 0) + 1; return script.n === 1 && script.toolFirst ? { text: null, toolCalls: [{ id: 'c1', name: 'file_read', input: { path: '/data/x' } }] } : { text: 'done', usage: { inputTokens: 1, outputTokens: 1 } } },
    tool: async (name) => { execs += 1; return { kind: 'inline-text', text: `{"echo":"${name}"}`, byte_length: 8, provenance: { context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' } } },
  }, execs: () => execs }
}
const RUN = `mn02e-${Date.now().toString(36)}`

// ── E1 腐坏 alarm 行 → sweepTick 跳过+原子消费 ────────────────────────
{
  const cas = mkCas('o1')
  const due = Date.now() - 9000
  await post('state/put-cas', { key: `alarms/${due}-${RUN}-bad`, body: '{{{not-json', cond: { ifNoneMatch: '*' } })
  const io = mkIo(cas).io
  const ran = await host.sweepTick({ kernel, io, owner: 'o1', holder: 'sweep-e1' }, { batchLimit: 10 })
  const gone = (await post('alarm/due', { now: Date.now() })).body.keys.every((k) => !k.includes(RUN))
  check('E1:腐坏 alarm → sweep 跳过+消费不阻塞', ran.every((r) => r.sessionId !== `${RUN}-bad`) && gone, `ran=${JSON.stringify(ran)}`)
}

// ── E2 腐坏 state 行 → loadSnap 抛出（诚实面：不静默新建）──────────────
{
  const cas = mkCas('o1')
  await post('state/put-cas', { key: `state/${RUN}-corrupt`, body: '{broken', cond: { ifNoneMatch: '*' } })
  let threw = false
  try { await host.runPump({ kernel, io: mkIo(cas).io, owner: 'o1', holder: 'h' }, `${RUN}-corrupt`, {}) } catch { threw = true }
  check('E2:腐坏 state → runPump 抛出（不伪造恢复）', threw === true)
}

// ── E3 超限 fragment → putCas 413 → saveSnap 抛出非 fenced ────────────
{
  const cas = mkCas('o1')
  const big = 'x'.repeat(300 * 1024)
  const r = await cas.putCas(`dsh-mini/state/o1/${RUN}-big`, big, { ifNoneMatch: '*' })
  check('E3:>256KB state → 413（非 412 误报 fenced）', r.status === 413, `status=${r.status}`)
}

// ── E4 双会话并发泵：异 claim 互不干扰（同 oid 双 sid）─────────────────
{
  const cas = mkCas('o1')
  const s1 = mkIo(cas, { toolFirst: true }); const s2 = mkIo(cas, { toolFirst: true })
  const [r1, r2] = await Promise.all([
    host.runPump({ kernel, io: s1.io, owner: 'o1', holder: 'p1' }, `${RUN}-p1`, { input: { role: 'user', content: 'a' } }),
    host.runPump({ kernel, io: s2.io, owner: 'o1', holder: 'p2' }, `${RUN}-p2`, { input: { role: 'user', content: 'b' } }),
  ])
  check('E4:双会话并发 completed+tool 各恰一次', r1.outcome === 'completed' && r2.outcome === 'completed' && s1.execs() === 1 && s2.execs() === 1, `o1=${r1.outcome} o2=${r2.outcome}`)
}

// ── E5 cancelRequested → cancel 完成 + claim 释放 ────────────────────
{
  const cas = mkCas('o1')
  const io = mkIo(cas).io
  const r = await host.runPump({ kernel, io, owner: 'o1', holder: 'h' }, `${RUN}-cancel`, { input: { role: 'user', content: 'x' }, cancelRequested: () => true })
  // claim 行释放语义=TTL 自然过期（remoteCas.del 对 claims 为 no-op——worker 同构）；
  // 有意义的断言=同 holder 即刻复跑不被拒（mp 恒持 'mp-foreground'）。
  const claimRow = await post('state/get', { key: `claims/${RUN}-cancel` })
  const r2 = await host.runPump({ kernel, io: mkIo(cas).io, owner: 'o1', holder: 'h' }, `${RUN}-cancel`, {})
  check('E5:cancel→completed + claim TTL-释放语义（同 holder 复跑通）', r.outcome === 'completed' && claimRow.status === 200 && r2.outcome === 'completed', `outcome=${r.outcome} claim=${claimRow.status} re-pump=${r2.outcome}`)
}

// ── E6 vfs 文件边缘（真 vfs+shim fs）──────────────────────────────────
{
  const { vfs } = await bundle(`import { vfs } from '${repo}/services/vfs/vfs'; export { vfs }`)
  const SID = `${RUN}-fs`
  vfs.write(`/data/${SID}/你好-世界.txt`, '中文内容-é', { sessionId: SID })
  const uni = vfs.read(`/data/${SID}/你好-世界.txt`, { sessionId: SID })
  check('E6:unicode 文件名+内容 round-trip', uni.text === '中文内容-é')
  vfs.write(`/data/${SID}/a/b/c/d/e/deep.txt`, 'deep', { sessionId: SID })
  check('E6:深层路径', vfs.stat(`/data/${SID}/a/b/c/d/e/deep.txt`, { sessionId: SID }).kind === 'file')
  const bin = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xfe]).buffer
  vfs.write(`/data/${SID}/bin.dat`, bin, { sessionId: SID, mime: 'application/octet-stream' })
  // vfs.read 内部 sha256(对象字节)===object_key 校验——不抛 hash-mismatch 即字节无损（text 面是 utf8 投影，二进制不承诺逐字）
  const b = vfs.read(`/data/${SID}/bin.dat`, { sessionId: SID })
  check('E6:二进制字节无损（read 内建 hash 校验通过）', b.size_bytes === 7 && b.eof === true)
  vfs.write(`/data/${SID}/empty.txt`, '', { sessionId: SID })
  check('E6:零字节文件', vfs.stat(`/data/${SID}/empty.txt`, { sessionId: SID }).size_bytes === 0)
  vfs.write(`/data/${SID}/over.txt`, 'v1', { sessionId: SID })
  const s1 = vfs.stat(`/data/${SID}/over.txt`, { sessionId: SID })
  vfs.write(`/data/${SID}/over.txt`, 'v2-longer', { sessionId: SID })
  const s2 = vfs.stat(`/data/${SID}/over.txt`, { sessionId: SID })
  check('E6:覆盖写 etag 推进', s2.object_version !== s1.object_version && vfs.read(`/data/${SID}/over.txt`, { sessionId: SID }).text === 'v2-longer')
  const bigContent = 'q'.repeat(400 * 1024)
  vfs.write(`/data/${SID}/big.txt`, bigContent, { sessionId: SID })
  const slice = vfs.read(`/data/${SID}/big.txt`, { sessionId: SID, offset: 100, maxBytes: 50 })
  check('E6:大文件 range 读', slice.text.length === 50 && slice.text === 'q'.repeat(50) && slice.truncated === true, `len=${slice.text.length} truncated=${slice.truncated}`)
}

// ── E7 GSTH-like tenant-handoff：同 oid transcript 可携带性 ──────────
{
  const provStub = stub('provider', `
import { createRemoteVfs } from '${repo}/services/vfs/remote'
const post = async (url, headers, body) => { const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }
const remote = createRemoteVfs({ baseUrl: '${BASE}', headers: () => ({ authorization: 'Bearer ${TICKET}' }), post })
export const vfsRemoteFor = () => remote
`)
  const { syncTranscript, readSessionPointer } = await bundle(
    `import { syncTranscript, readSessionPointer } from '${repo}/services/nano-mini-host/transcript'; export { syncTranscript, readSessionPointer }`,
    [swap('state\\/provider$', provStub)],
  )
  const sid = `${RUN}-handoff`
  const items = [
    { kind: 'user_message', id: 'u1', seq: 1, text: 'handoff 轮一', ts: Date.now() - 60000 },
    { kind: 'assistant_message', id: 'a1', seq: 2, text: '应答一', ts: Date.now() - 59000 },
  ]
  const r1 = await syncTranscript(sid, items, { model: 'gst-sim' })
  items.push({ kind: 'user_message', id: 'u2', seq: 3, text: 'handoff 轮二', ts: Date.now() - 30000 }, { kind: 'assistant_message', id: 'a2', seq: 4, text: '应答二', ts: Date.now() })
  const r2 = await syncTranscript(sid, items, { model: 'gst-sim' })
  check('E7:增量转录（次轮只推新行）', r1.pushed === 2 && r2.pushed === 2 && r2.skipped === 2, `r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`)
  // 新设备面（异进程无本地指针）→ 远端行全集拉取重建
  const keys = (await post('vfs/list', { prefix: `vfs/transcripts/${sid}/`, limit: 20 })).body.keys
  const seqRows = keys.filter((k) => /\/\d{6}\.json$/.test(k)).sort()
  const rebuilt = []
  for (const k of seqRows) { const g = await post('vfs/get', { key: k }); rebuilt.push(JSON.parse(Buffer.from(g.body.body_b64, 'base64').toString())) }
  check('E7:新设备 transcript 全量重建（行序+内容字节级）', seqRows.length === 4 && rebuilt.map((i) => i.seq).join(',') === '1,2,3,4' && rebuilt[3].text === '应答二', `rows=${seqRows.length}`)
  const ptr = readSessionPointer(sid)
  check('E7:durable 指针 last_seq=4', ptr?.last_seq === 4)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
