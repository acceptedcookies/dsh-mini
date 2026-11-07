// MN06 matrix —— C4a/C4b 先于 C1–C3（T-O-6/T-O-10）。
//
// 每个 case 同时断言 App（__diagnostics/errToasts/state）、shadow（同协议客户端）、
// God（admin S3 测试 bucket 键/字节）。数据面真，不 mock。
//
// 用法：node test/mn06/matrix.mjs [--only C4a,C4b] [--repeat N]
import { loadEnv, requireEnv, assertMode600, assertLocalEndpoint, report } from './env.mjs'
import { createShadow, sha256Hex } from './shadow.mjs'
import { createGod, stateKey, claimKey, vfsKey } from './god.mjs'
import { createApp, waitFor, sleep } from './app.mjs'

const env = loadEnv()
try {
  assertMode600()
  assertLocalEndpoint(env.BASE, 'BASE')
  assertLocalEndpoint(env.DURABLE, 'DURABLE')
  requireEnv(env, ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
} catch (e) {
  console.error(`[matrix] env: ${e?.message ?? e}`)
  process.exit(3)
}

const argv = process.argv.slice(2)
const onlyArg = argv.indexOf('--only')
const only = onlyArg >= 0 ? new Set((argv[onlyArg + 1] ?? '').split(',').filter(Boolean)) : null
const repeatArg = argv.indexOf('--repeat')
const repeat = Math.max(1, Number(repeatArg >= 0 ? argv[repeatArg + 1] : 1) || 1)
const RUN = `mn06-${Date.now().toString(36)}`
const cases = []

const shadow = await createShadow(env, env.TEST_OID)
const god = createGod(env)
let app = await createApp(env, env.TEST_OID)

function finish(id, parts, detail, started) {
  const appOk = parts.app === true
  const shadowOk = parts.shadow === true
  const godOk = parts.god === true
  const pass = appOk && shadowOk && godOk
  cases.push({ id, pass, app: appOk, shadow: shadowOk, god: godOk, detail: pass ? '' : detail, ms: Date.now() - started })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} :: app=${appOk} shadow=${shadowOk} god=${godOk}${pass ? '' : ` ${detail}`}`)
  return pass
}

await ensureCold()

async function ensureCold() {
  if ((await app.hasFreshTicket()) !== true) return true
  // 常驻会话已铸票：断开并用 cli-auto 新会话冷启 appService（模块级票据缓存清空）。
  await app.disconnect()
  app = await createApp(env, env.TEST_OID, { cold: true })
  return (await app.hasFreshTicket()) !== true
}

async function C4a() {
  const started = Date.now()
  const sid = `${RUN}-c4a`
  const path = `/data/${sid}/c4a.txt`
  const cold0 = await ensureCold()
  if (!cold0) { finish('C4a', { app: false, shadow: false, god: false }, 'App 无法回到无票冷态', started); return }
  const w = await app.writeVfs(path, 'c4a-offline')
  const local0 = await app.rowLocal(path)
  const cold1 = (await app.hasFreshTicket()) === false
  const shadowBefore = await shadow.row(path)
  const godBefore = await god.json(vfsKey(env.TEST_OID, `rows${path}`))
  const t = await app.ensureTicket()
  await app.pushAll()
  const shadowRow = await waitFor(() => shadow.row(path), 30000, 800)
  const godRow = await waitFor(() => god.json(vfsKey(env.TEST_OID, `rows${path}`)), 30000, 800)
  const appOk = w?.ok === true && local0 !== null && cold1 && (await app.hasFreshTicket()) === true
  const shadowOk = shadowBefore === null && shadowRow !== null
  const godOk = godBefore === null && godRow !== null && typeof godRow.object_key === 'string'
  finish('C4a', { app: appOk, shadow: shadowOk, god: godOk }, `cold=${cold0}/${cold1} mint=${JSON.stringify(t)} local=${local0 !== null} shadowBefore=${shadowBefore !== null} shadow=${shadowRow !== null} god=${godRow !== null}`, started)
}

async function C4b() {
  const started = Date.now()
  const sid = `${RUN}-c4b`
  const path = `/data/${sid}/c4b.txt`
  const cold0 = await ensureCold()
  if (!cold0) { finish('C4b', { app: false, shadow: false, god: false }, 'App 无法回到无票冷态', started); return }
  await app.writeVfs(path, 'c4b-offline')
  // 预置远端行（模拟跨设备已同步、随后本地离线删除）
  const seed = {
    virtual_path: path, object_key: 'ab'.repeat(32), content_hash: `sha256:${'ab'.repeat(32)}`,
    size_bytes: 3, mime: 'text/plain', placement: 'local-hub', lane: 'hub', committed: true, updated_ms: 1,
  }
  await shadow.remote.put(`rows${path}`, Buffer.from(JSON.stringify(seed)), { mime: 'application/json' })
  const d = await app.removeVfs(path)
  const localAfter = await app.rowLocal(path)
  const tombAtDelete = await app.tombstone(path)
  const cold1 = (await app.hasFreshTicket()) === false
  await app.ensureTicket()
  await app.pushAll()
  const shadowGone = await waitFor(async () => (await shadow.row(path)) === null, 30000, 800)
  const godGone = await waitFor(async () => (await god.json(vfsKey(env.TEST_OID, `rows${path}`))) === null, 30000, 800)
  const appOk = d?.ok === true && localAfter === null && cold1 && tombAtDelete !== null
  const shadowOk = shadowGone === true
  const godOk = godGone === true
  finish('C4b', { app: appOk, shadow: shadowOk, god: godOk }, `cold=${cold0}/${cold1} del=${JSON.stringify(d)} local=${localAfter === null} tomb=${JSON.stringify(tombAtDelete)} shadowGone=${shadowGone} godGone=${godGone}`, started)
}

async function C1() {
  const started = Date.now()
  await app.setEngine('nano-agent')
  const sid = await app.createSession()
  if (typeof sid !== 'string') { finish('C1', { app: false, shadow: false, god: false }, `createSession=${JSON.stringify(sid)}`, started); return }
  await app.ensureTicket()
  const p = await app.prompt('Reply with the single word: pong')
  const done = await waitFor(async () => {
    const s = await app.sessionState()
    return s && s.current && s.current.sessionId === sid && s.current.itemCount >= 2 && s.current.status !== 'error' ? s : null
  }, 180000, 1000)
  const diag = await app.diagnostics(sid)
  const state = await waitFor(() => shadow.getState(sid), 15000, 500)
  const godState = await waitFor(() => god.json(stateKey(env.TEST_OID, sid)), 15000, 500)
  const body = state?.body ?? ''
  const appOk = done !== undefined && diag?.session?.itemCount >= 2 && (diag.session.lastItems ?? []).some((i) => i.kind === 'assistant_message')
  const shadowOk = state !== null && typeof body === 'string' && body.includes('checkpoint')
  const godOk = godState !== null && JSON.stringify(godState).includes('checkpoint')
  finish('C1', { app: appOk, shadow: shadowOk, god: godOk }, `sid=${sid} prompt=${JSON.stringify(p)} itemCount=${diag?.session?.itemCount} shadow=${state !== null} god=${godState !== null}`, started)
}

async function C2() {
  const started = Date.now()
  await app.setEngine('nano-agent')
  const sid = await app.createSession()
  if (typeof sid !== 'string') { finish('C2', { app: false, shadow: false, god: false }, `createSession=${JSON.stringify(sid)}`, started); return }
  await app.ensureTicket()
  const cl = await shadow.claim(sid, 'shadow', 60000)
  const p = await app.prompt('hello from app while shadow holds claim')
  const errs = await waitFor(async () => {
    const e = await app.errors()
    const diag = await app.diagnostics(sid)
    const recent = diag?.errors?.recent ?? []
    const hit = [...(e?.toasts ?? []), ...recent].find((r) => `${r.message ?? ''}${r.title ?? ''}`.includes('会话写者冲突') || r.code === 'claim-denied')
    return hit ?? null
  }, 30000, 800)
  const claim = await shadow.raw('state/get', { key: `claims/${sid}` })
  const godClaim = await god.json(claimKey(env.TEST_OID, sid))
  const appOk = cl?.status === 200 && errs !== null
  const shadowOk = claim.status === 200 && JSON.parse(claim.body.body).holder === 'shadow'
  const godOk = godClaim !== null && godClaim.holder === 'shadow'
  finish('C2', { app: appOk, shadow: shadowOk, god: godOk }, `sid=${sid} claim=${cl?.status} prompt=${JSON.stringify(p)} err=${JSON.stringify(errs)} godHolder=${godClaim?.holder}`, started)
}

async function C3() {
  const started = Date.now()
  await app.setEngine('nano-agent')
  const sid = `${RUN}-c3`
  const path = `/data/${sid}/c3.txt`
  await app.ensureTicket()
  const w = await app.writeVfs(path, 'c3-bytes')
  const pus = await app.pushPath(path)
  const row = await waitFor(() => shadow.row(path), 30000, 800)
  if (row === null) { finish('C3', { app: w?.ok === true, shadow: false, god: false }, `row not visible push=${JSON.stringify(pus)}`, started); return }
  const bytes = await shadow.object(row.object_key)
  const shaOk = bytes !== null && sha256Hex(bytes) === row.object_key
  const textOk = bytes !== null && Buffer.from(bytes).toString('utf8') === 'c3-bytes'
  const godObj = await god.get(vfsKey(env.TEST_OID, `objects/${row.object_key}`))
  const godRow = await god.json(vfsKey(env.TEST_OID, `rows${path}`))
  const appRead = await app.readVfs(path)
  const appOk = w?.ok === true && appRead?.text === 'c3-bytes'
  const shadowOk = shaOk && textOk
  const godOk = godObj !== null && Buffer.from(godObj).toString('utf8') === 'c3-bytes' && godRow !== null
  finish('C3', { app: appOk, shadow: shadowOk, god: godOk }, `sha=${shaOk} text=${textOk} godObj=${godObj !== null} godRow=${godRow !== null}`, started)
}

const ALL = [['C4a', C4a], ['C4b', C4b], ['C1', C1], ['C2', C2], ['C3', C3]]
try {
  for (let i = 0; i < repeat; i += 1) {
    for (const [id, fn] of ALL) {
      if (only !== null && !only.has(id)) continue
      try { await fn() } catch (e) {
        const started = Date.now()
        finish(repeat > 1 ? `${id}#${i + 1}` : id, { app: false, shadow: false, god: false }, String(e?.stack ?? e).slice(0, 500), started)
      }
    }
  }
} finally {
  await app.disconnect()
}

const failed = cases.filter((c) => !c.pass)
report('mn06', cases, { ran_at: new Date().toISOString(), base: env.BASE, oid: env.TEST_OID, repeat })
console.log(`\n${cases.length - failed.length}/${cases.length} PASS @ ${new Date().toISOString()} base=${env.BASE}`)
process.exit(failed.length === 0 ? 0 : 1)
