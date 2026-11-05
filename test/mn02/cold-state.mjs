// MN02-B3 G2 实验：kernel 执行态（fragment）经 remoteCas 落 POD1 fss3，
// 杀泵（宿主死亡模拟）→ 冷归档行留在服务端 → 新泵热取回续跑完成。
// 与 mn01-harness N2/N2b/N3/N4 同构，唯一变量：io.state 换成真 remoteCas。
// 用法：TICKET=$(...) BASE=https://dsh-mini.haimang.com.cn node test/mn02/cold-state.mjs
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
const kernel = (() => { const b = require(join(repo, 'cloud/functions/sweeper/vendor/kernel.cjs')); return b.kernel ?? b })()
const host = require(join(repo, 'cloud/functions/sweeper/vendor/host.cjs'))

const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const entry = join(mkdtempSync(join(tmpdir(), 'mn02cs-')), 'entry.ts')
writeFileSync(entry, `
import { createRemoteCas } from '${repo}/services/state/remote-cas'
export { createRemoteCas }
`)
const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent' })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { createRemoteCas } = mod.exports

const post = async (url, headers, body) => {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const mkCas = () => createRemoteCas({
  baseUrl: BASE, owner: 'o1',
  headers: () => ({ authorization: `Bearer ${TICKET}` }),
  post,
})
// 旁路 API（验证行在服务端，不经 cas 句柄）
const api = async (ep, body) => {
  const r = await fetch(`${BASE}/v1/${ep}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TICKET}` },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }
const enc = (s) => Buffer.byteLength(s, 'utf8')
const prov = () => ({ context_layer: 'transcript', context_role: 'assistant', context_property: 'tool-result' })
const RUN = `mn02cs-${Date.now().toString(36)}`

function makeIo(cas, script = {}) {
  let toolExecs = 0
  return {
    state: cas,
    toolExecs: () => toolExecs,
    llm: async () => {
      script.llmCalls = (script.llmCalls ?? 0) + 1
      if (script.llmCalls === 1 && script.toolFirst) {
        return { text: null, toolCalls: [{ id: 'c1', name: 'file_read', input: { path: '/data/x' } }] }
      }
      return { text: 'done', usage: { inputTokens: 5, outputTokens: 3 } }
    },
    tool: async (name) => {
      toolExecs += 1
      return { kind: 'inline-text', text: `{"echo":"${name}"}`, byte_length: enc(name), provenance: prov() }
    },
  }
}

// ── C1 kill-after-2 → 新 cas 句柄热取回 → completed；服务端行可旁路读 ──
{
  const SID = `${RUN}-c1`
  const cas = mkCas()
  const script = { toolFirst: true }
  const io = makeIo(cas, script)
  const r1 = await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, SID, { input: { role: 'user', content: 'hi' }, killAfter: 2 })
  check('C1:killed-mid-turn', r1.outcome === 'killed', `outcome=${r1.outcome} trace=${r1.trace.join('>')}`)
  // 冷归档断言：state 行真实存在于 POD1（不经 cas 句柄，直打 API）
  const srv = await api('state/get', { key: `state/${SID}` })
  check('C1:fragment-cold-archived', srv.status === 200 && typeof srv.body.body === 'string' && srv.body.body.includes('checkpoint'), `etag=${srv.body?.etag?.slice(0, 12)} body=${String(srv.body?.body).slice(0, 80)}`)
  // 新 cas 句柄 + 新 io（模拟全新宿主进程）热取回
  const cas2 = mkCas()
  const io2 = makeIo(cas2, script)
  const r2 = await host.runPump({ kernel, io: io2, owner: 'o1', holder: 'h1' }, SID, {})
  check('C1:hot-resume-completed', r2.outcome === 'completed', `outcome=${r2.outcome}`)
  check('C1:tool-exactly-once', io.toolExecs() + io2.toolExecs() === 1, `execs=${io.toolExecs()}+${io2.toolExecs()}`)
}

// ── C2 kill-after-tool + 异 holder 接管（claim 过期面）──────────────
{
  const SID = `${RUN}-c2`
  const cas = mkCas()
  const script = { toolFirst: true }
  const io = makeIo(cas, script)
  const r1 = await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, SID, { input: { role: 'user', content: 'hi' }, killAfter: 3, claimTtlMs: 0 })
  check('C2:killed-after-tool', r1.outcome === 'killed' && io.toolExecs() === 1, `outcome=${r1.outcome}`)
  const io2 = makeIo(mkCas(), script)
  const r2 = await host.runPump({ kernel, io: io2, owner: 'o1', holder: 'h2' }, SID, {})
  check('C2:resume-other-holder', r2.outcome === 'completed', `outcome=${r2.outcome} trace=${r2.trace.join('>')}`)
  check('C2:tool-still-once', io.toolExecs() + io2.toolExecs() === 1)
}

// ── C3 活租约 claim-denied（fencing 语义经真端点）────────────────────
{
  const SID = `${RUN}-c3`
  await api('claim', { key: SID, holder: 'rival', ttlMs: 60000 })
  const io = makeIo(mkCas())
  const r = await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, SID, {})
  check('C3:claim-denied', r.outcome === 'claim-denied' && r.rival === 'rival', `outcome=${r.outcome} rival=${r.rival}`)
}

// ── C4 alarm→sweep→resume：due alarm 行 → sweepTick 取回续跑 → at-most-once ──
{
  const SID = `${RUN}-c4`
  const cas = mkCas()
  const script = { toolFirst: true }
  const io = makeIo(cas, script)
  // 先跑死一轮留 fragment（claimTtlMs:0 让租约即刻过期，sweep 可接管），再手写 due alarm 行
  await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, SID, { input: { role: 'user', content: 'hi' }, killAfter: 1, claimTtlMs: 0 })
  const dueTs = Date.now() - 5000
  await api('state/put-cas', { key: `alarms/${dueTs}-${SID}`, body: JSON.stringify({ sessionId: SID, kind: 'turn-resume', dueAt: dueTs, fence: 'x' }) })
  const io2 = makeIo(mkCas(), script)
  const ran = await host.sweepTick({ kernel, io: io2, owner: 'o1', holder: 'sweep' }, { batchLimit: 10 }, () => io2)
  check('C4:sweep-ran-completed', ran.length === 1 && ran[0].sessionId === SID && ran[0].outcome === 'completed', `ran=${JSON.stringify(ran)}`)
  const io3 = makeIo(mkCas(), script)
  const ran2 = await host.sweepTick({ kernel, io: io3, owner: 'o1', holder: 'sweep' }, { batchLimit: 10 }, () => io3)
  check('C4:at-most-once', ran2.length === 0, `re-sweep=${ran2.length}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}  base=${BASE}`)
process.exit(failed.length === 0 ? 0 : 1)
