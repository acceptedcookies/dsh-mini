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

// ── E2 腐坏 state 行 → reset 重建（审查十四轮 M5 契约更新：腐行不再永砖，
//   loadSnap warn+fresh 重建，PumpResult.reset 上抛供宿主落账注记——不伪造无恢复）──
{
  const cas = mkCas('o1')
  await post('state/put-cas', { key: `state/${RUN}-corrupt`, body: '{broken', cond: { ifNoneMatch: '*' } })
  const r = await host.runPump({ kernel, io: mkIo(cas).io, owner: 'o1', holder: 'h' }, `${RUN}-corrupt`, {})
  check('E2:腐坏 state → 不抛出且 reset=true（恢复+宿主注记面）', r.reset === true, `r=${JSON.stringify(r)}`)
  // 重建后新快照落盘，下轮 loadSnap 正常读——腐行被覆写不残留（永砖解除断言）。
  const row = await cas.get(`dsh-mini/state/o1/${RUN}-corrupt`)
  const healthy = await host.runPump({ kernel, io: mkIo(cas).io, owner: 'o1', holder: 'h' }, `${RUN}-corrupt`, {})
  check('E2:重建行已覆写（二轮 reset=false）', row !== null && healthy.reset !== true, `row=${row !== null} r2.reset=${healthy.reset}`)
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

// ── E8 B8 修复面验证 ─────────────────────────────────────────────────
// mount read-through、mirror 钩子、claim 心跳、manifest CAS、vfs/list 续页。
{
  const { vfs, setVfsMirrorHook } = await bundle(`import { vfs, setVfsMirrorHook } from '${repo}/services/vfs/vfs'; export { vfs, setVfsMirrorHook }`)
  const { vfsStore } = await bundle(`import { vfsStore } from '${repo}/services/vfs/store'; export { vfsStore }`)
  const SID = `${RUN}-mt`
  vfs.write(`/data/${SID}/proj/a.txt`, 'through', { sessionId: SID })
  vfs.write(`/data/${SID}/proj/sub/b.txt`, 'through2', { sessionId: SID })
  vfsStore.putMount({ name: 'mt-ws', workspace: 'mt-ws', sessions: [SID], created_ms: Date.now() })
  const r1 = vfs.read(`/mnt/mt-ws/${SID}/proj/a.txt`, { sessionId: 'other' })
  check('E8:mount read-through 文件', r1.text === 'through')
  const l1 = vfs.list(`/mnt/mt-ws/${SID}/proj`, { sessionId: 'other' })
  check('E8:mount 深层 list 投影', l1.entries.length === 2 && l1.entries.every((e) => e.path.startsWith('/mnt/')), JSON.stringify(l1.entries.map((e) => e.path)))
  const s1 = vfs.stat(`/mnt/mt-ws/${SID}/proj/sub`, { sessionId: 'other' })
  const s2 = vfs.stat(`/mnt/mt-ws/${SID}/proj/ghost`, { sessionId: 'other' })
  const s3 = vfs.stat(`/mnt/mt-ws/not-mounted/x`, { sessionId: 'other' })
  check('E8:mount stat 投影 file/dir/none', s1.kind === 'dir' && s2.kind === 'none' && s3.kind === 'none', `${s1.kind}/${s2.kind}/${s3.kind}`)
  let hookErr = null
  try { vfs.list(`/mnt/mt-ws/not-mounted`, { sessionId: 'other' }) } catch (e) { hookErr = e.code }
  check('E8:mount 未挂 sid list → path-not-found', hookErr === 'path-not-found')

  // mirror 钩子：write→pushPath、remove→pushRemove（真 RemoteVfs + POD1）
  const { createRemoteVfs } = await bundle(`import { createRemoteVfs } from '${repo}/services/vfs/remote'; export { createRemoteVfs }`)
  const { createVfsSync: mkSync } = await bundle(`import { createVfsSync } from '${repo}/services/vfs/remote-sync'; export { createVfsSync }`)
  const rv = createRemoteVfs({ baseUrl: BASE, headers: () => ({ authorization: `Bearer ${TICKET}` }), post: async (u, h, b) => { const r = await fetch(u, { method: 'POST', headers: h, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) } } })
  const sync = mkSync(rv)
  const mir = `${RUN}-mir`
  setVfsMirrorHook((path, kind) => {
    const p = kind === 'write' ? sync.pushPath(path) : sync.pushRemove(path)
    p.catch(() => {})
  })
  // 推送是异步网络往返——轮询等待而非定值 sleep（POD1 跨国延迟抖动）。
  const waitFor = async (key, want, ms = 10000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const g = await post('vfs/get', { key })
      if (g.status === want) return g
      await new Promise((r) => setTimeout(r, 400))
    }
    return post('vfs/get', { key })
  }
  vfs.write(`/data/${mir}/hooked.txt`, 'mirrored', { sessionId: mir })
  const rowKey = `vfs/rows/data/${mir}/hooked.txt`
  const g1 = await waitFor(rowKey, 200)
  check('E8:mirror 钩子 write→远端行', g1.status === 200)
  vfs.write(`/tmp/${mir}/scratch.txt`, 'no-mirror', { sessionId: mir })
  await new Promise((r) => setTimeout(r, 1500))
  const g2 = await post('vfs/get', { key: `vfs/rows/tmp/${mir}/scratch.txt` })
  check('E8:mirror scratch 不镜像', g2.status === 404)
  vfs.remove(`/data/${mir}/hooked.txt`, { sessionId: mir })
  const g3 = await waitFor(rowKey, 404)
  check('E8:mirror 钩子 remove→远端行删', g3.status === 404, `status=${g3.status}`)
  setVfsMirrorHook(undefined)

  // manifest CAS：mountSession 保留对手条目（并发合并）
  await sync.mountSession(`${RUN}-cas`, 'sess-a')
  // 模拟对手直写清单丢条目 → 再 mount 另一 sid → 两条都活
  const mk = await post('vfs/get', { key: `vfs/workspaces/${RUN}-cas.json` })
  const mani = JSON.parse(Buffer.from(mk.body.body_b64, 'base64').toString())
  mani.sessions = ['rival-sess']
  await post('vfs/put', { key: `vfs/workspaces/${RUN}-cas.json`, bytes_b64: Buffer.from(JSON.stringify(mani)).toString('base64') })
  await sync.mountSession(`${RUN}-cas`, 'sess-b')
  const mk2 = await post('vfs/get', { key: `vfs/workspaces/${RUN}-cas.json` })
  const mani2 = JSON.parse(Buffer.from(mk2.body.body_b64, 'base64').toString())
  check('E8:manifest CAS 保留对手条目', mani2.sessions.includes('rival-sess') && mani2.sessions.includes('sess-b'), JSON.stringify(mani2.sessions))

  // vfs/list 续页：limit=2 翻页拿全
  const pref = `vfs/rows/data/${mir}p/`
  for (let i = 0; i < 3; i++) await post('vfs/put', { key: `${pref}f${i}.txt`, bytes_b64: Buffer.from('x').toString('base64') })
  const p1 = await post('vfs/list', { prefix: pref, limit: 2 })
  const p2 = await post('vfs/list', { prefix: pref, limit: 2, start_after: p1.body.next_token })
  check('E8:vfs/list 续页（truncated+next_token）', p1.body.truncated === true && p1.body.keys.length === 2 && p2.body.keys.length === 1 && p2.body.truncated === false, `p1=${p1.body.keys?.length} p2=${p2.body.keys?.length}`)

  // CJK 续页：目录项编码序（% 前）≠解码序（CJK 殿后）——混排+limit=1 逐页，
  // 旧实现按编码序走、游标按解码比 → 永久丢键（审查 B8 实证后修 store.list）。
  const cjkP = `vfs/rows/data/${mir}-cjk/`
  for (const n of ['a.txt', '中.txt', 'b.txt']) await post('vfs/put', { key: `${cjkP}${n}`, bytes_b64: Buffer.from('x').toString('base64') })
  const seen = []
  let tok
  for (let i = 0; i < 6; i++) {
    const pg = await post('vfs/list', { prefix: cjkP, limit: 1, start_after: tok })
    seen.push(...(pg.body.keys ?? []))
    tok = pg.body.truncated === true ? pg.body.next_token : undefined
    if (tok === undefined) break
  }
  const want = [`${cjkP}a.txt`, `${cjkP}b.txt`, `${cjkP}中.txt`]
  check('E8:vfs/list CJK 续页解码序不丢键', JSON.stringify(seen) === JSON.stringify(want), JSON.stringify(seen))

  // manifest 创建竞态：双 sync 并发挂同新 workspace——ifNoneMatch 使负者重读
  // 合并（旧码 cur=null 无条件写 → 一写覆盖丢条目，审查 B8）。
  const sync2 = mkSync(rv)
  const raceWs = `${RUN}-race`
  await Promise.all([sync.mountSession(raceWs, 'sess-x'), sync2.mountSession(raceWs, 'sess-y')])
  const rm = await post('vfs/get', { key: `vfs/workspaces/${raceWs}.json` })
  const rmani = JSON.parse(Buffer.from(rm.body.body_b64, 'base64').toString())
  check('E8:manifest 创建竞态双 sid 双活', rmani.sessions.includes('sess-x') && rmani.sessions.includes('sess-y'), JSON.stringify(rmani.sessions))

  // claim 心跳（审查三轮重写：结构性证据非时间面）——claimTtlMs=300 + 慢 tool(500ms)，
  // 远端 CAS 每调用 ~百 ms，步边界必然越过 70% 续窗。claim 键 putCas 计数：
  // 初始写恒=1，有续约≥2——expires 阈值断言被远端延迟噪声架空，写次数不可伪造。
  const baseCas = mkCas('o1')
  let claimWrites = 0
  const cas = {
    ...baseCas,
    putCas: async (key, body, cond) => {
      const r = await baseCas.putCas(key, body, cond)
      if (key.includes('/claims/')) claimWrites += 1
      return r
    },
  }
  let slow = 0
  const hbIo = {
    state: cas,
    llm: async () => { slow += 1; return slow === 1 ? { toolCalls: [{ id: 'c1', name: 'file_read', input: {} }] } : { text: 'hb done' } },
    tool: async () => { await new Promise((r) => setTimeout(r, 500)); return { kind: 'inline-text', text: '{}', byte_length: 2, provenance: { context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' } } },
  }
  const hb = await host.runPump({ kernel, io: hbIo, owner: 'o1', holder: 'hb' }, `${RUN}-hb`, { input: { role: 'user', content: 'x' }, claimTtlMs: 300 })
  check('E8:claim 心跳（turn 内续约——claim 写≥2）', hb.outcome === 'completed' && claimWrites >= 2, `outcome=${hb.outcome} claimWrites=${claimWrites}`)
}

// ── E9 模型优先级：设置页显式选择 > enrollment.model（审查 B8 回归）─────
// local 车道（cfg 在场）：activeModel 归一化；cfg 缺席（生产云车道）：
// 白名单内显式选择仍赢 enrollment，无效/未选回退 enrollment.model。
{
  const { createIoLlm } = await bundle(`import { createIoLlm } from '${repo}/services/nano-mini-host/io/llm'; export { createIoLlm }`, [
    swap(/fx\/dev$/, stub('dev', `export const currentRoute = () => ({ mode: 'local' })
export const loadDevConfig = () => ({ providerName: 'magpie', upstreamBaseUrl: 'http://127.0.0.1:9', providerApiKey: '', model: 'cfg-model', allowedModels: [], sim: { baseUrl: '' }, cloud: { envId: '', proxyUrl: '' } })`)),
  ])
  let wire = null
  const llm = createIoLlm({ request: async (_u, _h, data) => { wire = data; return { status: 200, body: { choices: [{ message: { content: 'ok' } }] } } } })
  const msg = [{ role: 'user', content: [{ kind: 'text', text: 'x' }] }]

  wx.setStorageSync('dsh:model:v2', 'workbuddy/deepseek-v4-pro')
  wx.setStorageSync('dsh:byok-enrollment:v1', { provider: 'byok', upstreamBaseUrl: 'http://127.0.0.1:9', model: 'deepseek-flash' })
  await llm(msg)
  check('E9:cfg 在场 picked>enrollment（设置页赢）', wire.model === 'workbuddy/deepseek-v4-pro', `model=${wire.model}`)

  wx.setStorageSync('dsh:model:v2', 'bogus-model-x')
  await llm(msg)
  check('E9:picked 不在白名单→归一化默认', wire.model === 'workbuddy/deepseek-v4.1-flash', `model=${wire.model}`)
}

// cfg 缺席云车道：route=cloud 无 proxyBaseUrl → LocalTicketProvider（零网络），
// enrollment 已注入 → ready() 走 manual 源，model 只看 io/llm 的解析序。
{
  const { createIoLlm } = await bundle(`import { createIoLlm } from '${repo}/services/nano-mini-host/io/llm'; export { createIoLlm }`, [
    swap(/fx\/dev$/, stub('devc', `export const currentRoute = () => ({ mode: 'cloud' })
export const loadDevConfig = () => undefined`)),
  ])
  let wire = null
  const llm = createIoLlm({ request: async (_u, _h, data) => { wire = data; return { status: 200, body: { choices: [{ message: { content: 'ok' } }] } } } })
  const msg = [{ role: 'user', content: [{ kind: 'text', text: 'x' }] }]
  // enrollment.model 故意取非 MODELS 值——能区分「picked 赢」与「enrollment 兜底」。
  wx.setStorageSync('dsh:byok-enrollment:v1', { provider: 'byok', upstreamBaseUrl: 'http://127.0.0.1:9', model: 'enrolled-upstream-model' })

  wx.setStorageSync('dsh:model:v2', 'deepseek-flash')
  await llm(msg)
  check('E9:cfg 缺席 picked∈MODELS 仍赢 enrollment', wire.model === 'deepseek-flash', `model=${wire.model}`)

  wx.setStorageSync('dsh:model:v2', 'bogus-model-x')
  await llm(msg)
  check('E9:cfg 缺席 picked 非法→enrollment 兜底', wire.model === 'enrolled-upstream-model', `model=${wire.model}`)

  wx.removeStorageSync('dsh:model:v2')
  await llm(msg)
  check('E9:cfg 缺席未选→enrollment.model', wire.model === 'enrolled-upstream-model', `model=${wire.model}`)

  wx.removeStorageSync('dsh:model:v2')
  wx.removeStorageSync('dsh:byok-enrollment:v1')
}

// ── E10 冷启动云车道铸票序（审查三轮 N1 回归）─────────────────────────
// 死锁原状：authHeaders 缓存只读后，runPump 首个 claim 在 io.llm.ready() 之前——
// 无票据冷启动/过期后 401 且永无铸票路径。修复：drive 在 runPump 前 ensureDurableTicket()。
// 本块用真 provider+真 ticket 模块+真 POD1：wx 边界外无 stub——
// challenge/unlock 走 wx.cloud stub（返真票据），SOTER stub，wx.request→fetch 真发。
{
  const devCloud = stub('devp', `export const currentRoute = () => ({ mode: 'cloud', proxyBaseUrl: 'https://proxy.invalid', cloudEnvId: 'e1' })
export const loadDevConfig = () => ({ providerName: 'byok', upstreamBaseUrl: 'http://u.invalid', providerApiKey: '', model: 'm', allowedModels: [], sim: { baseUrl: '' }, cloud: { envId: 'e1', proxyUrl: 'https://proxy.invalid', durableUrl: '${BASE}' } })`)
  const mod = await bundle(
    `import { ensureDurableTicket, ioStateFor } from '${repo}/services/state/provider'
import { hasFreshTicket } from '${repo}/services/fx/ticket'
export { ensureDurableTicket, ioStateFor, hasFreshTicket }`,
    // ticket.ts 从 './dev' 导入 currentRoute——单 'fx/dev$' 滤不到（真实 dev 被
    // 打进 bundle → issuer 指纹异源 → hasFreshTicket 假阴）。滤器须双吃。
    [swap('(\\/dev$|^\\.\\/dev$)', devCloud)],
  )
  wx.setStorageSync('dsh:byok-enrollment:v1', { provider: 'byok', upstreamBaseUrl: 'http://u.invalid', model: 'm' })
  let soterCalls = 0
  wx.cloud = {
    init: () => {},
    callFunction: async ({ name, data }) => name === 'unlock' && data.action === 'challenge'
      ? { result: { challenge: 'c1' } }
      : { result: { ticket: TICKET, exp: Math.floor(Date.now() / 1000) + 1800 } },
  }
  wx.startSoterAuthentication = (o) => { soterCalls += 1; o.success({ resultJSON: '{}', resultJSONSignature: 'sig' }) }
  wx.request = (o) => {
    fetch(o.url, { method: o.method, headers: o.header, body: JSON.stringify(o.data) })
      .then(async (r) => o.success({ statusCode: r.status, data: await r.json().catch(() => null) }))
      .catch((e) => (o.fail ?? (() => {}))({ errMsg: String(e) }))
  }

  check('E10:冷启动 hasFreshTicket=false', mod.hasFreshTicket() === false, '')
  const cas = mod.ioStateFor()
  let preErr = ''
  await cas.get('probe-x').catch((e) => { preErr = String(e) })
  check('E10:铸票前 durable get→401（死锁面复现）', preErr.includes('401'), `err=${preErr.slice(0, 60)}`)

  await mod.ensureDurableTicket()
  check('E10:ensureDurableTicket→SOTER+unlock 铸票', soterCalls === 1 && mod.hasFreshTicket() === true, `soter=${soterCalls}`)

  const wkey = `dsh-mini/state/probe/${RUN}-e10`
  const wr = await cas.putCas(wkey, JSON.stringify({ ok: 1 }), { ifNoneMatch: '*' })
  const rd = await cas.get(wkey)
  check('E10:铸票后同 cas 获权（put+get roundtrip）', wr.status === 200 && rd !== null && JSON.parse(rd.body).ok === 1, `wr=${wr.status} rd=${rd !== null}`)
  await cas.del(wkey).catch(() => {})
  wx.removeStorageSync('dsh:byok-enrollment:v1')
}

// ── E11 sweepTick 非终态重臂（审查三轮 N8）─────────────────────────────
// claim-denied 不再同 dueAt 留行（每 tick 满步重跑=烧 llm）：消费原行 + 新 dueTs
// 退避重建，attempts 记账。重臂行 30s 后到期——alarm/due 用未来 now 面见其存在。
{
  const cas = mkCas('o1')
  const raSid = `${RUN}-ra`
  // rival 持有 claim（60s 有效）→ sweep 泵同会话必得 claim-denied。
  await post('state/put-cas', { key: `claims/${raSid}`, body: JSON.stringify({ holder: 'rival-e11', expires: new Date(Date.now() + 60000).toISOString() }), cond: { ifNoneMatch: '*' } })
  const due = Date.now() - 1000
  await post('state/put-cas', { key: `alarms/${due}-${raSid}`, body: JSON.stringify({ sessionId: raSid, kind: 'turn-resume', dueAt: due, fence: 'new' }), cond: { ifNoneMatch: '*' } })
  const io = mkIo(cas).io
  const ran = await host.sweepTick({ kernel, io, owner: 'o1', holder: 'sw-e11' }, { batchLimit: 10 })
  const hit = ran.find((r) => r.sessionId === raSid)
  // 精确剥 due 前缀后比 sid：includes(sid) 会被 `${RUN}-race` 的前缀误伤（E11 曾假红）。
  const dueSid = (k) => k.match(/^alarms\/(?:[^/]+\/)?\d+-(.+)$/)?.[1]
  const nowDue = (await post('alarm/due', { now: Date.now() })).body.keys.filter((k) => dueSid(k) === raSid)
  const futureDue = (await post('alarm/due', { now: Date.now() + 120000 })).body.keys.filter((k) => dueSid(k) === raSid)
  check('E11:claim-denied→原行消费+退避重臂', hit?.outcome === 'claim-denied' && nowDue.length === 0 && futureDue.length === 1, `outcome=${hit?.outcome} now=${nowDue.length} future=${futureDue.length}`)
  // 重臂行消费验体：attempts=1 记账 + dueAt 在未来。
  // due-list 线键形如 alarms/{due}-{sid}（或全形 alarms/{oid}/{due}-{sid}）——双形剥壳。
  const ck = futureDue[0]?.replace(/^alarms\//, '').replace(/^[^/]+\//, '')
  const cl = ck !== undefined ? await post('alarm/claim', { key: ck, holder: 'e11-verify' }) : { status: 0, body: null }
  const rec = cl.status === 200 ? JSON.parse(cl.body.body) : null
  check('E11:重臂行 attempts=1+dueAt 退避未来', rec?.attempts === 1 && typeof rec?.dueAt === 'number' && rec.dueAt > Date.now(), `attempts=${rec?.attempts} dueIn=${rec !== null ? rec.dueAt - Date.now() : 'n/a'}ms`)
}

// ── E12 审查四轮修复面：异常重臂（F2）+ 删除墓碑（F3）──────────────────
{
  const cas = mkCas('o1')
  // F2：io.llm 抛 → runPump 异常——异常同样走重臂账，不再永留原 dueAt 行
  // 每 tick 满步重跑（确定性故障烧 llm 的无界面）。原触发面（腐坏 state→loadSnap
  // 抛）在审查十四轮 M5 已改 reset 重建，异常触发面换 llm 抛保持同等覆盖。
  const csSid = `${RUN}-cs`
  const due2 = Date.now() - 1000
  await post('state/put-cas', { key: `alarms/${due2}-${csSid}`, body: JSON.stringify({ sessionId: csSid, kind: 'turn-resume', dueAt: due2, fence: 'new' }), cond: { ifNoneMatch: '*' } })
  const io2 = mkIo(cas).io
  io2.llm = async () => { throw new Error('deterministic-llm-fault') }
  const ran2 = await host.sweepTick({ kernel, io: io2, owner: 'o1', holder: 'sw-e12' }, { batchLimit: 10 })
  const dueSid2 = (k) => k.match(/^alarms\/(?:[^/]+\/)?\d+-(.+)$/)?.[1]
  const nowDue2 = (await post('alarm/due', { now: Date.now() })).body.keys.filter((k) => dueSid2(k) === csSid)
  const futureDue2 = (await post('alarm/due', { now: Date.now() + 120000 })).body.keys.filter((k) => dueSid2(k) === csSid)
  const ck2 = futureDue2[0]?.replace(/^alarms\//, '').replace(/^[^/]+\//, '')
  const cl2 = ck2 !== undefined ? await post('alarm/claim', { key: ck2, holder: 'e12-verify' }) : { status: 0, body: null }
  const rec2 = cl2.status === 200 ? JSON.parse(cl2.body.body) : null
  check('E12:异常路径同走重臂账（F2）', nowDue2.length === 0 && rec2?.attempts === 1 && rec2.dueAt > Date.now(), `now=${nowDue2.length} attempts=${rec2?.attempts}`)

  // F3 墓碑：远端行在而本地有删除碑（模拟 pushRemove 曾失败）——pullRows 不复活
  // 且重发删除收敛；远端行新于碑=真重建则复活（LWW）。
  const { createRemoteVfs } = await bundle(`import { createRemoteVfs } from '${repo}/services/vfs/remote'; export { createRemoteVfs }`)
  const { createVfsSync: mkSync } = await bundle(`import { createVfsSync } from '${repo}/services/vfs/remote-sync'; export { createVfsSync }`)
  const rv = createRemoteVfs({ baseUrl: BASE, headers: () => ({ authorization: `Bearer ${TICKET}` }), post: async (u, h, b) => { const r = await fetch(u, { method: 'POST', headers: h, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) } } })
  const sync = mkSync(rv)
  const tombPath = `/data/${RUN}-tomb/f1.txt`
  const tombRow = { virtual_path: tombPath, object_key: 'ab'.repeat(32), content_hash: 'ab'.repeat(32), size_bytes: 1, mime: 'text/plain', placement: 'durable', lane: 'durable', committed: true, updated_ms: 1 }
  await rv.put(`rows/data/${RUN}-tomb/f1.txt`, Buffer.from(JSON.stringify(tombRow)), { mime: 'application/json' })
  wx.setStorageSync('dsh:mini:vfs-tombstones', { [tombPath]: Date.now() })
  const pulled3 = await sync.pullRows()
  const end = Date.now() + 8000
  let gone = false
  while (Date.now() < end) { if ((await rv.get(`rows/data/${RUN}-tomb/f1.txt`)) === null) { gone = true; break } await new Promise((r) => setTimeout(r, 400)) }
  check('E12:墓碑行不复活+重删收敛（F3）', !pulled3.includes(tombPath) && gone === true, `pulled=${pulled3.length} gone=${gone}`)
  // 远端行新于墓碑=真重建 → pullRows 复活+清碑（LWW 语义不吞真写）。
  const newer = { ...tombRow, updated_ms: Date.now() + 1000 }
  await rv.put(`rows/data/${RUN}-tomb/f1.txt`, Buffer.from(JSON.stringify(newer)), { mime: 'application/json' })
  const pulled4 = await sync.pullRows()
  const { vfsStore } = await bundle(`import { vfsStore } from '${repo}/services/vfs/store'; export { vfsStore }`)
  check('E12:远端新于墓碑→真重建复活（F3 LWW）', pulled4.includes(tombPath) && vfsStore.getRow(tombPath) !== undefined, `pulled=${pulled4.includes(tombPath)}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
