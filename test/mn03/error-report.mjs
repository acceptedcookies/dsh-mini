// MN03-B1 error-report 抽象 Node 级测试：taxonomy 全 code 映射 / http status
// 抽取 / 启发式 / dedupe 同窗 / toast+modal 队列 / ring buffer cap /
// surface 路由 / reportText 全文 / diagnostics bundle schema。
// 真源码 esbuild bundle（与 mn02 同范式），wx 面走 mn01 wx-shim。
// 用法：node test/mn03/error-report.mjs
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'package.json'))
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const bundle = async (entry, plugins = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'mn03-'))
  const ent = join(dir, 'entry.ts')
  writeFileSync(ent, entry)
  const out = await esbuild.build({ entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent', plugins })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(join(repo, 'package.json')))
  return mod.exports
}

const { classifyError, errorBus, reportText, reportSilent } = await bundle(
  `import { classifyError, errorBus, reportText, reportSilent } from '${repo}/services/error-report'; export { classifyError, errorBus, reportText, reportSilent }`,
)

// ── taxonomy：已知 code 注册表 ─────────────────────────────────────
{
  const cases = [
    [{ type: 'error', code: 'ticket-required', message: 'x', retryable: true }, 'ticket', 'modal', 'error'],
    [{ type: 'error', code: 'kernel-unavailable', message: 'x' }, 'runtime', 'modal', 'fatal'],
    [{ type: 'error', code: 'image-resolve-failed', message: 'x' }, 'image', 'modal', 'error'],
    [{ type: 'error', code: 'fenced', message: 'x' }, 'runtime', 'modal', 'error'],
    [{ type: 'error', code: 'claim-denied', message: 'x' }, 'runtime', 'modal', 'error'],
    [{ type: 'error', code: 'step-exhausted', message: 'x' }, 'runtime', 'modal', 'error'],
    [{ type: 'error', code: 'pump-error', message: 'x' }, 'runtime', 'modal', 'error'],
    [{ type: 'error', code: 'protocol', message: 'x' }, 'protocol', 'modal', 'error'],
    [{ type: 'error', code: 'nano.prompt', message: 'x' }, 'upstream', 'modal', 'error'],
    [{ type: 'error', code: 'cancelled', message: 'x' }, 'cancelled', 'silent', 'info'],
  ]
  const bad = cases.filter(([input, cat, surf, sev]) => {
    const r = classifyError(input)
    return r.category !== cat || r.surface !== surf || r.severity !== sev
  })
  check('T1:已知 code taxonomy 映射（10 code）', bad.length === 0, bad.map((b) => b[0].code).join(','))
}

// ── http status 抽取（io.llm 真实 message 形状）─────────────────────
{
  const s503 = classifyError(new Error('io.llm upstream 503: {"error":"unavailable"}'))
  const s401 = classifyError(new Error('io.llm upstream 401 Unauthorized'))
  const s429 = classifyError(new Error('io.llm upstream 429: rate limited'))
  const s400 = classifyError(new Error('io.llm upstream 400: bad request'))
  check('T2:503→upstream-5xx modal + status 抽取', s503.code === 'upstream-503' && s503.category === 'upstream' && s503.surface === 'modal' && s503.diagnostics.status === 503 && s503.diagnostics.retryable === true, JSON.stringify({ code: s503.code, status: s503.diagnostics.status }))
  check('T3:401→upstream-auth（ticket category）', s401.code === 'upstream-401' && s401.category === 'ticket' && s401.diagnostics.retryable === false)
  check('T4:429→rate-limit toast warn', s429.code === 'upstream-429' && s429.surface === 'toast' && s429.severity === 'warn')
  check('T5:400→upstream-4xx modal 不可重试', s400.code === 'upstream-400' && s400.surface === 'modal' && s400.diagnostics.retryable === false)
}

// ── 启发式（网络/存储/vfs/权限/会话/路由/未知）────────────────────────
{
  const cases = [
    [new Error('request:fail timeout'), 'network-timeout'],
    [new Error('ECONNREFUSED 127.0.0.1:3425'), 'network-error'],
    [new Error('setStorageSync:fail exceed storage size'), 'storage-quota'],
    [new Error('vfs.read-only-path /root'), 'vfs-access'],
    [new Error('hash-mismatch sha256'), 'vfs-integrity'],
    [new Error('permission-denied'), 'permission-denied'],
    [new Error('会话不存在 sid=x'), 'session-missing'],
    [new Error('localRuntimeRoute 解析失败'), 'route-config'],
    [new Error('totally unanticipated'), 'unknown-error'],
  ]
  const bad = cases.filter(([input, code]) => classifyError(input).code !== code)
  check('T6:启发式归一化（9 形态）', bad.length === 0, bad.map((b) => classifyError(b[0]).code).join(','))
  const unk = classifyError(new Error('totally unanticipated'), { op: 'prompt', lane: 'fx' })
  check('T7:unknown→modal + ctx 落 diagnostics', unk.surface === 'modal' && unk.diagnostics.op === 'prompt' && unk.diagnostics.lane === 'fx' && unk.diagnostics.stack !== undefined)
}

// ── ctx 字段与 retryable 优先级 ────────────────────────────────────
{
  const r = classifyError(new Error('timed out'), { op: 'prompt', lane: 'kernel', route: 'local', model: 'deepseek-chat', sessionId: 's1', retryable: false })
  check('T8:diagnostics ctx 全字段落账', r.diagnostics.op === 'prompt' && r.diagnostics.lane === 'kernel' && r.diagnostics.route === 'local' && r.diagnostics.model === 'deepseek-chat' && r.diagnostics.sessionId === 's1' && r.diagnostics.retryable === false)
  const ev = classifyError({ type: 'error', code: 'host-error', message: 'm', retryable: false })
  check('T9:事件 retryable 覆盖 taxon 默认', ev.diagnostics.retryable === false)
}

// ── 分类序防误伤（MN03-R1 修复）：status/具体域锚定先于自由文本 ────────────
{
  const c1 = classifyError(new Error('io.llm upstream 503 aborted'))
  check('M1:upstream 503 aborted→upstream-503（不被 abort 吞成 cancelled）', c1.code === 'upstream-503' && c1.surface === 'modal' && c1.category === 'upstream', `code=${c1.code} surface=${c1.surface}`)
  const c2 = classifyError(new Error('io.llm upstream 504 request timed out'))
  check('M2:status 抽取先于 timeout 启发式', c2.code === 'upstream-504' && c2.category === 'upstream')
  const c3 = classifyError(new Error('upstream 429 retry aborted'))
  check('M3:429+abort→rate-limit toast', c3.code === 'upstream-429' && c3.surface === 'toast')
  const c4 = classifyError(new Error('request:fail abort'))
  check('M4:纯用户 abort 仍归 cancelled silent', c4.code === 'cancelled' && c4.surface === 'silent')
  const c5 = classifyError({ type: 'error', code: 'alarm-abandoned', message: '后台恢复 s1 重试 5 次仍 pump-error——已放弃', retryable: false })
  check('M5:alarm-abandoned→runtime warn toast', c5.code === 'alarm-abandoned' && c5.category === 'runtime' && c5.surface === 'toast')
  // R2 修复验收
  const c6 = classifyError(new Error('io.llm upstream 429: {"error":"insufficient_quota"}'))
  check('M6:429 体含 quota→rate-limit（不被 quota 抢成 storage-quota）', c6.code === 'upstream-429' && c6.category === 'upstream' && c6.surface === 'toast', `code=${c6.code}`)
  const c7 = classifyError(new Error('ECONNREFUSED 127.0.0.1:443'))
  check('M7:端口 :443 不误归 upstream-443→network-error', c7.code === 'network-error' && c7.category === 'network' && c7.surface === 'toast', `code=${c7.code}`)
  const c8 = classifyError(Object.assign(new Error('登录已失效'), { status: 401 }))
  check('M8:对象 status=401→upstream-401（NanoApiError 面）', c8.code === 'upstream-401' && c8.category === 'ticket' && c8.diagnostics.status === 401)
  const c9 = classifyError(new Error('setStorageSync:fail exceed storage size limit'))
  check('M9:wx 配额 errMsg 仍归 storage-quota modal', c9.code === 'storage-quota' && c9.surface === 'modal')
}

// ── bus：surface 路由 + dedupe + cap + 队列 ─────────────────────────
{
  errorBus.clear()
  // toast 路由 + dedupe（同 code+sessionId <1.5s 合并 count）
  errorBus.report(new Error('request:fail timeout'), { sessionId: 's1' })
  errorBus.report(new Error('request:fail timeout'), { sessionId: 's1' })
  const st = errorBus.state()
  check('B1:dedupe 同窗合并（count=2 单 toast）', st.toasts.length === 1 && st.toasts[0].count === 2, JSON.stringify(st.toasts.map((t) => [t.code, t.count])))
  // toast 并发上限 3，溢出进队列
  errorBus.clear()
  for (let i = 0; i < 5; i += 1) errorBus.report(new Error(`timed out ${i}`), { sessionId: `s${i}` })
  const st2 = errorBus.state()
  check('B2:toast cap 3 + 溢出队列', st2.toasts.length === 3 && st2.pendingCount === 2, `toasts=${st2.toasts.length} pending=${st2.pendingCount}`)
  const promoted = st2.toasts[0].id
  errorBus.dismiss(promoted)
  check('B3:dismiss 提拔队列 toast', errorBus.state().toasts.length === 3 && errorBus.state().pendingCount === 1)
  // 非滑窗 dedupe：合并保留首条 report 对象（id/ts 不漂，R1 修复）
  errorBus.clear()
  const first = errorBus.report(new Error('request:fail timeout'), { sessionId: 'ns1' })
  const merged = errorBus.report(new Error('request:fail timeout'), { sessionId: 'ns1' })
  check('B3b:dedupe 合并保留首条对象（id/ts 不滑窗）', merged.id === first.id && merged.ts === first.ts && merged.count === 2)
}

// ── bus：surface 限定 dismiss + FIFO openDetail（R1 修复）──────────────
{
  errorBus.clear()
  errorBus.report(new Error('io.llm upstream 500'), { sessionId: 'sd' }) // modal active
  errorBus.report(new Error('io.llm upstream 502'), { sessionId: 'sd' }) // modal queued
  errorBus.report(new Error('request:fail timeout'), { sessionId: 'sd' }) // toast
  const tid = errorBus.state().toasts[0].id
  errorBus.dismiss(tid, 'modal') // 同 id 指定 modal 面——不得误删 toast
  check('B3c:surface 限定 dismiss(modal) 不动 toast', errorBus.state().toasts.length === 1)
  errorBus.openDetail(tid) // 升舱 FIFO：进 modalQueue 尾（modal-502 之后）
  const st = errorBus.state()
  check('B3d:openDetail 升舱入队尾（FIFO）', st.toasts.length === 0 && st.pendingCount === 2)
  errorBus.dismiss(st.modal.id, 'modal')
  const next = errorBus.state()
  check('B3e:dismiss modal 提拔 502（升舱的 toast 仍在队尾）', next.modal?.code === 'upstream-502')
  // toast 自动关回调带 surface=toast——不得关掉 modal（同帧竞态，R1）
  errorBus.clear()
  errorBus.report(new Error('request:fail timeout'))
  const autoTid = errorBus.state().toasts[0].id
  errorBus.report(new Error('io.llm upstream 503'))
  errorBus.dismiss(autoTid, 'toast')
  const st2 = errorBus.state()
  check('B3f:surface=toast dismiss 不伤 modal', st2.toasts.length === 0 && st2.modal?.code === 'upstream-503')
}

// ── bus：modal 队列 + openDetail 升舱 ──────────────────────────────
{
  errorBus.clear()
  errorBus.report(new Error('io.llm upstream 500'))
  errorBus.report(new Error('io.llm upstream 502'))
  const st = errorBus.state()
  check('B4:modal 单活 + 队列', st.modal !== undefined && st.modal.code === 'upstream-500' && st.pendingCount === 1)
  const firstId = st.modal.id
  errorBus.dismiss(firstId)
  check('B5:modal dismiss 提拔下一个', errorBus.state().modal?.code === 'upstream-502' && errorBus.state().pendingCount === 0)
  errorBus.clear()
  errorBus.report(new Error('request:fail timeout'))
  const toastId = errorBus.state().toasts[0].id
  errorBus.openDetail(toastId)
  const after = errorBus.state()
  check('B6:openDetail toast→modal', after.toasts.length === 0 && after.modal !== undefined && after.modal.id === toastId)
}

// ── bus：silent 面 + ring buffer cap + recent ───────────────────────
{
  errorBus.clear()
  // 不同 sessionId 破 dedupe 键——70 条相异 silent 才走 cap 面（R1 后同键合并）。
  for (let i = 0; i < 70; i += 1) {
    const r = classifyError(new Error(`silent-${i}`), { sessionId: `cap${i}` })
    r.surface = 'silent'
    errorBus.report(r)
  }
  const st = errorBus.state()
  check('B7:silent 不弹仅台账 + cap64', st.toasts.length === 0 && st.modal === undefined && errorBus.recent(100).length === 64, `recent=${errorBus.recent(100).length}`)
  check('B8:recent 保尾部序', errorBus.recent(1)[0].message === 'silent-69')
  // silent dedupe（R1）：同窗同码同会话的连续 silent 合并计数，不冲 ring buffer
  errorBus.clear()
  for (let i = 0; i < 30; i += 1) reportSilent(new Error('request:fail timeout'), { sessionId: 'sil1' })
  const tail = errorBus.recent(10)
  const same = tail.filter((r) => r.code === 'network-timeout' && r.diagnostics.sessionId === 'sil1')
  check('B8b:silent 同窗 dedupe 合并计数', same.length === 1 && same[0].count === 30, `entries=${same.length} count=${same[0]?.count}`)
}

// ── storage.writeSafe：quota 抛错→errorBus 标准化（R1 修复）────────────
{
  // 同 bundle 实例外——storage 与 bus 须同模块图
  const { storage: stg, errorBus: bus3 } = await bundle(
    `import { storage } from '${repo}/services/storage';
     import { errorBus } from '${repo}/services/error-report';
     export { storage, errorBus }`,
  )
  bus3.clear()
  const orig = wx.setStorageSync
  wx.setStorageSync = () => { throw new Error('setStorageSync:fail exceed storage size limit') }
  stg.setModel('deepseek-chat')
  wx.setStorageSync = orig
  const hits = bus3.recent(10).filter((r) => r.code === 'storage-quota' && r.diagnostics.op === 'storage.setModel')
  check('S1:writeSafe quota→storage-quota modal + op 落 diagnostics', hits.length === 1 && hits[0].surface === 'modal' && hits[0].category === 'storage', hits.map((r) => `${r.code}@${r.diagnostics.op}`).join(','))
}

// ── reportText 全文（复制错误全文共享渲染）───────────────────────────
{
  const r = classifyError(new Error('io.llm upstream 503: boom'), { op: 'prompt', lane: 'kernel', sessionId: 's9' })
  const text = reportText(r)
  check('B9:reportText 含 code/op/lane/session/status/ISO ts', text.includes('code: upstream-503') && text.includes('op: prompt') && text.includes('lane: kernel') && text.includes('sessionId: s9') && text.includes('status: 503') && /\d{4}-\d{2}-\d{2}T/.test(text))
}

// ── diagnostics bundle schema（G2 真源）─────────────────────────────
// 注意：与 error-report 须同 bundle 实例外——各自 bundle 是两个 errorBus 单例。
{
  const { sessionDiagnostics, DIAG_SCHEMA, bus2 } = await bundle(
    `import { sessionDiagnostics, DIAG_SCHEMA } from '${repo}/services/diagnostics';
     import { errorBus } from '${repo}/services/error-report';
     export { sessionDiagnostics, DIAG_SCHEMA, errorBus as bus2 }`,
  )
  const bundle_ = sessionDiagnostics()
  const ok = bundle_.schema === 'dsh-mini.diag.v1' && DIAG_SCHEMA === 'dsh-mini.diag.v1'
    && typeof bundle_.ts === 'number'
    && typeof bundle_.runtime.lane === 'string' && typeof bundle_.runtime.label === 'string' && typeof bundle_.runtime.route === 'string'
    && Array.isArray(bundle_.sessions)
    && typeof bundle_.vfs === 'object' && Array.isArray(bundle_.vfs.mounts) && Array.isArray(bundle_.vfs.sessionRows)
    && typeof bundle_.errors === 'object' && Array.isArray(bundle_.errors.recent)
    && bundle_.env.version === '0.3.0'
  check('D1:无会话 bundle schema 全字段', ok, `lane=${bundle_.runtime.lane} route=${bundle_.runtime.route}`)
  // 错误台账进 bundle：先报一条再取（用同 bundle 的 bus 实例）
  bus2.clear()
  bus2.report(new Error('io.llm upstream 503'), { op: 'prompt', sessionId: 'diag-s' })
  const b2 = sessionDiagnostics('diag-s')
  check('D2:bundle.errors.recent 含新报错误', b2.errors.recent.some((r) => r.code === 'upstream-503' && r.diagnostics.sessionId === 'diag-s'))
  check('D3:未知 sid → durable.sessionPtr 缺席（如实）', b2.durable.sessionPtr === undefined)
}

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
