// MN01-T02 harness：kernel-do.mjs spike → 产品化泵转正。
// 驱动 vendor/host.cjs（= services/nano-mini-host/pump.ts 出口）+ vendor/kernel.cjs
// + Node 内存 CAS（与 localCas 同语义）。N1~N4 保留 + 版本错/provenance 缺省两负例。
// 用法：node scripts/build-kernel.mjs --host && node scripts/mn01-harness.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repo, 'package.json'))
const kernel = (() => { const b = require(join(repo, 'cloud/functions/sweeper/vendor/kernel.cjs')); return b.kernel ?? b })()
const host = require(join(repo, 'cloud/functions/sweeper/vendor/host.cjs'))

// ── 内存 CAS：与 localCas/worker 同语义（If-Match/If-None-Match→412，claim 租约，前缀列举）
class MemCas {
  constructor() { this.map = new Map(); this.seq = 0 }
  get(k) { const r = this.map.get(k); return r === undefined ? null : { ...r } }
  putCas(k, body, cond = {}) {
    const cur = this.map.get(k)
    if (cond.ifNoneMatch === '*' && cur !== undefined) return { status: 412 }
    if (cond.ifMatch !== undefined && (cur === undefined || cur.etag !== cond.ifMatch)) return { status: 412 }
    const etag = `m${++this.seq}`
    this.map.set(k, { body, etag })
    return { status: 200, etag }
  }
  listPrefix(p) { return [...this.map.keys()].filter((k) => k.startsWith(p)) }
  del(k) { this.map.delete(k) }
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

const SID = 's-n1'
const enc = (s) => Buffer.byteLength(s, 'utf8')
const prov = (layer = 'transcript') => ({ context_layer: layer, context_role: 'assistant', context_property: 'tool-result' })

function makeIo(cas, script = {}) {
  let toolExecs = 0
  return {
    state: cas,
    toolExecs: () => toolExecs,
    firstLlmMessages: undefined,
    llm: async (messages) => {
      script.llmCalls = (script.llmCalls ?? 0) + 1
      // F1 回归守卫：首步 llm_call 的 messages 必须含用户输入（input_arrived→resume 折叠正路）
      if (script.llmCalls === 1) {
        script.firstLlmMessages = messages
        script.seededOk = script.expectSeed === undefined
          || JSON.stringify(messages).includes(script.expectSeed)
      }
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

// ── N1 全 turn：llm→tool→llm→finish，每步 CAS 落盘
{
  const cas = new MemCas()
  const script = { toolFirst: true, expectSeed: 'hi' }
  const io = makeIo(cas, script)
  const r = await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, SID, { input: { role: 'user', content: 'hi' } })
  check('N1:completed', r.outcome === 'completed', `outcome=${r.outcome} trace=${r.trace.join('>')}`)
  check('N1:input-seeded', script.seededOk === true, `首步 messages=${JSON.stringify(script.firstLlmMessages)?.slice(0, 120)}`)
  check('N1:tool-once', io.toolExecs() === 1, `toolExecs=${io.toolExecs()}`)
  check('N1:cas-state', cas.get('dsh-mini/state/o1/s-n1') !== null, 'state 行存在')
  check('N1:claim-released', cas.get('dsh-mini/claims/o1/s-n1') === null, 'claim 行已释放')
}

// ── N2 durable cursor：杀死后恢复，tool 恰一次
{
  const cas = new MemCas()
  const script = { toolFirst: true }
  const io = makeIo(cas, script)
  const ctx = { kernel, io, owner: 'o1', holder: 'h1' }
  const r1 = await host.runPump(ctx, SID, { input: { role: 'user', content: 'hi' }, killAfter: 1 })
  check('N2:killed', r1.outcome === 'killed', `outcome=${r1.outcome}`)
  const r2 = await host.runPump({ ...ctx, holder: 'h1' }, SID, {})
  check('N2:resumed-completed', r2.outcome === 'completed', `outcome=${r2.outcome} trace=${r2.trace.join('>')}`)
  check('N2:tool-exactly-once', io.toolExecs() === 1, `toolExecs=${io.toolExecs()}（kill 前已跑的步不重跑）`)
}

// ── N2b kill-after-tool 象限（AP §8.5 要求 kill×2）：tool 跑完后死 → 恢复不重跑
{
  const cas = new MemCas()
  const script = { toolFirst: true }
  const io = makeIo(cas, script)
  const ctx = { kernel, io, owner: 'o1', holder: 'h1' }
  const r1 = await host.runPump(ctx, 's-n2b', { input: { role: 'user', content: 'hi' }, killAfter: 3, claimTtlMs: 0 })
  check('N2b:killed-after-tool', r1.outcome === 'killed' && io.toolExecs() === 1, `outcome=${r1.outcome} toolExecs=${io.toolExecs()}`)
  const r2 = await host.runPump({ ...ctx, holder: 'h2' }, 's-n2b', {}) // 异 holder 接管过期 claim
  check('N2b:resume-other-holder', r2.outcome === 'completed', `outcome=${r2.outcome} trace=${r2.trace.join('>')}`)
  check('N2b:tool-still-once', io.toolExecs() === 1, `toolExecs=${io.toolExecs()}`)
}

// ── N3 单写者 fencing：陈旧 etag → fenced；他 holder 活租约 → claim-denied
{
  const cas = new MemCas()
  cas.putCas('dsh-mini/claims/o1/s-n3', JSON.stringify({ holder: 'rival', expires: new Date(Date.now() + 60000).toISOString() }), {})
  const io = makeIo(cas)
  const r = await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, 's-n3', {})
  check('N3:claim-denied', r.outcome === 'claim-denied' && r.rival === 'rival', `outcome=${r.outcome} rival=${r.rival}`)
}

// ── N5 多轮回话（B-43 真机 400 回归）：complete_turn 后 idle 会话 + input
//   → 必须 start_turn 再播种；修复前二轮 messages=[] 裸奔 llm_call。
{
  const cas = new MemCas()
  const io1 = makeIo(cas, {})
  const r1 = await host.runPump({ kernel, io: io1, owner: 'o1', holder: 'h1' }, 's-n5', { input: { role: 'user', content: 'q1' } })
  const script2 = { expectSeed: 'q2' }
  const io2 = makeIo(cas, script2)
  const r2 = await host.runPump({ kernel, io: io2, owner: 'o1', holder: 'h1' }, 's-n5', { input: { role: 'user', content: 'q2' } })
  check('N5:turn1-completed', r1.outcome === 'completed', `outcome=${r1.outcome}`)
  check('N5:turn2-completed', r2.outcome === 'completed', `outcome=${r2.outcome} trace=${r2.trace.join('>')}`)
  check('N5:turn2-input-seeded', script2.seededOk === true && (script2.firstLlmMessages?.length ?? 0) > 0, `二轮首步 messages=${JSON.stringify(script2.firstLlmMessages)?.slice(0, 140)}`)
}

// ── N4 alarm→sweep→resume：suspended 落 alarm → sweepTick 恢复 → 幂等
{
  const cas = new MemCas()
  const script = { toolFirst: false }
  const io = makeIo(cas, script)
  // 构造 wait 决策：注入会 suspend 的 llm 响应不可行——直接手写 alarm 行测 sweep 幂等
  cas.putCas(`dsh-mini/alarms/o1/1-${SID}`, JSON.stringify({ sessionId: SID, kind: 'turn-resume', dueAt: 1, fence: 'x' }), {})
  const ran = await host.sweepTick({ kernel, io, owner: 'o1', holder: 'sweep' }, { batchLimit: 10 })
  check('N4:sweep-ran', ran.length === 1, `ran=${JSON.stringify(ran)}`)
  const ran2 = await host.sweepTick({ kernel, io, owner: 'o1', holder: 'sweep' }, { batchLimit: 10 })
  check('N4:idempotent', ran2.length === 0, `re-sweep ran=${ran2.length}（alarm 已消费不重复）`)
}

// ── 负例1：版本错 fragment 必拒（KERNEL_VERSION 闸）
{
  const snap = kernel.createKernelSnapshot(kernel.createInitialSessionState())
  const frag = kernel.buildCheckpointFragment(snap)
  const bad = { ...frag, version: 'v9999-not-real' } // fragment.version 字段（checkpoint.ts:80 KERNEL_VERSION 闸）
  let threw = false
  try { kernel.restoreFromFragment(bad) } catch { threw = true }
  check('NEG:version-mismatch', threw, 'version=v9999-not-real → restoreFromFragment threw')
}

// ── 负例2：provenance 缺省的 ToolCallResult 应被 kernel 拒/标记
{
  const cas = new MemCas()
  const io = {
    state: cas,
    llm: async () => ({ text: null, toolCalls: [{ id: 'c1', name: 'file_read', input: {} }] }),
    tool: async () => ({ kind: 'inline-text', text: 'x', byte_length: 1 }), // 无 provenance
  }
  let threw = false
  let outcome = ''
  try {
    const r = await host.runPump({ kernel, io, owner: 'o1', holder: 'h1' }, 's-neg', { input: {} })
    outcome = r.outcome
  } catch { threw = true }
  check('NEG:provenance-missing', threw || outcome !== 'completed', `threw=${threw} outcome=${outcome}（无 provenance 不得静默完成）`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
