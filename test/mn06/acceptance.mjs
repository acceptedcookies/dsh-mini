// MN06-T17/T19a —— 9 行验收矩阵：本轮跑 regression，消费同轮 artifact（token 防历史输出）。
//
// - #1 迁移：mp-remote/public-surface/cold-state + POD1 测试 oid 前缀只读 before/after。
// - #2–#8：从 regression artifact 的 PASS 行取三层/载体证据，不读旧日志。
// - #9：handoff/probe 双 sha/docs-check；不实现 EP-2。
// #1/#5/#6 显式 partial（生产切流 / 云函数 sweeper / 物理 OS kill deferred）。
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, requireEnv, assertMode600, assertLocalEndpoint, report } from './env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const env = loadEnv()
try {
  assertMode600()
  assertLocalEndpoint(env.BASE, 'BASE')
  assertLocalEndpoint(env.DURABLE, 'DURABLE')
  requireEnv(env, ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
} catch (e) {
  console.error(`[acceptance] env: ${e?.message ?? e}`)
  process.exit(3)
}

const TOKEN = randomUUID()
const OUT = `/tmp/mn06-acceptance-${TOKEN}.json`
const START = new Date()
const POD1 = 'root@pod1.saobao.com'
const POD1_META = '/srv/dsh-mini/data/meta/dsh-mini'
const POD1_OBJ = '/srv/dsh-mini/data/objects/dsh-mini'
const OID_GLOB = "\\( -path '*mn06-test-oid/*' -o -path '*mn06-test-oid-b/*' \\)"

function pod1Audit(beforeEpoch = 0) {
  const newer = beforeEpoch > 0
    ? `-newermt "$(date -u -d @${beforeEpoch} '+%Y-%m-%d %H:%M:%S')"`
    : ''
  const cmd = [
    'set -e',
    'date -u +%s',
    `find ${POD1_META} ${POD1_OBJ} -type f ${OID_GLOB} ${newer} -print | wc -l`,
    `find ${POD1_META} ${POD1_OBJ} -type f ${OID_GLOB} -print | wc -l`,
    `find ${POD1_META} ${POD1_OBJ} -type f ${newer} -print | wc -l`,
  ].join('; ')
  try {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', POD1, cmd], { encoding: 'utf8', timeout: 30000 })
    const n = out.trim().split('\n').map((x) => Number(x.trim()))
    if (n.some((x) => !Number.isFinite(x))) throw new Error(`bad output ${JSON.stringify(out.slice(0, 200))}`)
    return { ok: true, epoch: n[0], newOidFiles: n[1], oidFiles: n[2], newAllFiles: n[3] }
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 300) }
  }
}

const before = pod1Audit()
console.log(`[acceptance] POD1 before ${JSON.stringify(before)}`)

const regression = await new Promise((resolve) => {
  const p = spawn(process.execPath, [join(ROOT, 'test/mn06/regression.mjs')], {
    env: { ...process.env, MN06_REGRESSION_OUT: OUT, MN06_REGRESSION_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { err += d })
  const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* gone */ } }, 900000)
  p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out, err }) })
})
if (regression.code !== 0) {
  console.error(regression.out.split('\n').filter((l) => /FAIL|known_pre_existing/.test(l)).slice(-12).join('\n'))
  console.error(regression.err.slice(-800))
}
const after = pod1Audit(before.ok ? before.epoch : 0)
console.log(`[acceptance] POD1 after ${JSON.stringify(after)}`)

let artifact = null
try {
  const raw = JSON.parse(readFileSync(OUT, 'utf8'))
  if (raw.token !== TOKEN) throw new Error('token mismatch')
  if (new Date(raw.ran_at) < START) throw new Error(`artifact stale: ${raw.ran_at} < ${START.toISOString()}`)
  artifact = raw
} catch (e) {
  console.error(`[acceptance] regression artifact: ${e?.message ?? e}`)
}

const byName = Object.fromEntries((artifact?.tests ?? []).map((t) => [t.name, t]))
const suite = (name) => byName[name]
const suiteOk = (name) => suite(name)?.status === 'pass'
const suiteKnown = (name) => suite(name)?.status === 'known_pre_existing'
const line = (name, re) => (suite(name)?.lines ?? []).some((l) => re.test(l))
const row = (id, scope, state, evidence) => ({
  id,
  pass: state === 'green' || state === 'partial',
  scope,
  evidence_state: state,
  evidence,
})

const rows = []
{
  const carriers = ['mp-remote', 'public-surface', 'cold-state']
  const suitesOk = carriers.every(suiteOk)
  const podOk = before.ok && after.ok && after.newOidFiles === 0 && after.oidFiles === 0 && after.newAllFiles === 0
  rows.push(row(1, 'in-scope', suitesOk && podOk ? 'partial' : 'blocked',
    `${carriers.map((n) => `${n}:${suite(n)?.pass ?? '?'}/${suite(n)?.fail ?? '?'}`).join(' ')}; POD1 before=${JSON.stringify(before)} after=${JSON.stringify(after)}; 生产切流 deferred`))
}
{
  const app = line('matrix', /^PASS C1 :: app=true shadow=true god=true/)
  const cold = line('cold-state', /^PASS C1:fragment-cold-archived/) && line('cold-state', /^PASS C1:hot-resume-completed/)
  rows.push(row(2, 'in-scope', app && cold ? 'green' : 'blocked', `matrix C1 app/shadow/god=${app}; cold-state C1 checkpoint/hot-resume=${cold}`))
}
{
  const app = line('matrix', /^PASS C2 :: app=true shadow=true god=true/)
  rows.push(row(3, 'in-scope', app ? 'green' : 'blocked', `matrix C2 三层=${app}（app diag=会话写者冲突；God holder=shadow）`))
}
{
  const app = line('matrix', /^PASS C3 :: app=true shadow=true god=true/)
  rows.push(row(4, 'in-scope', app ? 'green' : 'blocked', `matrix C3 三层=${app}（shadow sha256 自验 + God object/row）`))
}
{
  const ticks = line('alarm30', /^PASS loop:≥2 tick/)
  const interval = line('alarm30', /^PASS loop:间隔 ≥30000ms/)
  const cold = line('cold-state', /^PASS C4:sweep-ran-completed/) && line('cold-state', /^PASS C4:at-most-once/)
  const edge = (suiteOk('edge-matrix') || suiteKnown('edge-matrix')) && line('edge-matrix', /^PASS E11:claim-denied→原行消费\+退避重臂/)
  rows.push(row(5, 'in-scope', ticks && interval && cold && edge ? 'partial' : 'blocked',
    `alarm30 ticks=${ticks} interval≥30s=${interval}; cold-state C4=${cold}; edge-matrix E11=${edge}; LLM scripted；云函数 sweeper 部署 deferred`))
}
{
  const c1 = line('cold-state', /^PASS C1:killed-mid-turn/) && line('cold-state', /^PASS C1:hot-resume-completed/) && line('cold-state', /^PASS C1:tool-exactly-once/)
  const c2 = line('cold-state', /^PASS C2:killed-after-tool/) && line('cold-state', /^PASS C2:resume-other-holder/) && line('cold-state', /^PASS C2:tool-still-once/)
  rows.push(row(6, 'in-scope', c1 && c2 ? 'partial' : 'blocked', `cold-state C1=${c1} C2=${c2}；killAfter=pump 级注入（进程级模拟），物理 OS kill/真机 deferred`))
}
{
  const c4a = line('matrix', /^PASS C4a :: app=true shadow=true god=true/)
  const c4b = line('matrix', /^PASS C4b :: app=true shadow=true god=true/)
  rows.push(row(7, 'in-scope', c4a && c4b ? 'green' : 'blocked', `cold App 无票 C4a=${c4a} C4b=${c4b}（写/删→铸票→God 行/对象/不复活）`))
}
{
  const e12 = line('edge-matrix', /^PASS E12:墓碑行不复活\+重删收敛/) && line('edge-matrix', /^PASS E12:远端新于墓碑→真重建复活/)
  const c4b = line('matrix', /^PASS C4b :: app=true shadow=true god=true/)
  rows.push(row(8, 'in-scope', (suiteOk('edge-matrix') || suiteKnown('edge-matrix')) && e12 && c4b ? 'green' : 'blocked', `edge-matrix E12=${e12}; matrix C4b=${c4b}`))
}
{
  const handoff = join(ROOT, 'docs/truth/mini-nano/MN06-ep2-handoff.md')
  const text = existsSync(handoff) ? readFileSync(handoff, 'utf8') : ''
  const probe = /probe commit \| `([0-9a-f]{40})`/.exec(text)?.[1] ?? ''
  const revert = /revert commit \| `([0-9a-f]{40})`/.exec(text)?.[1] ?? ''
  const shaOk = [probe, revert].every((sha) => {
    try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'ignore' }); return true } catch { return false }
  })
  const worker = readFileSync(join(ROOT, 'cloud/worker/worker.mjs'), 'utf8')
  const noProbe = !/probe/.test(worker.match(/key\.match\(([^)]*)\)/)?.[1] ?? '')
  const docs = suiteOk('docs-check')
  rows.push(row(9, 'in-scope', docs && text.length > 0 && shaOk && noProbe ? 'green' : 'blocked',
    `docs-check=${docs}; handoff=${text.length > 0}; probe/revert sha=${shaOk} (${probe.slice(0, 8)}/${revert.slice(0, 8)}); worker 无 probe=${noProbe}; 无 EP-2 设计`))
}

// T18 是硬闸：任一套件未 green/known（含未被 9 行直接引用的闸），9 行不得绿。
const regressionGreen = artifact !== null && regression.code === 0 && artifact.tests.every((t) => t.status === 'pass' || (t.name === 'edge-matrix' && t.status === 'known_pre_existing') || (t.name === 'ide-durable' && t.status === 'partial'))
if (!regressionGreen) {
  for (const r of rows) {
    r.pass = false
    r.evidence_state = 'blocked'
    r.evidence += `; regression 未全绿（exit=${regression.code}）`
  }
}
for (const r of rows) {
  const tag = r.pass ? 'PASS' : 'FAIL'
  console.log(`${tag} row#${r.id} [${r.scope}/${r.evidence_state}] ${r.evidence}`)
}

const failed = rows.filter((r) => !r.pass)
const resultPath = process.env.MN06_ACCEPTANCE_OUT ?? `/tmp/mn06-acceptance-result-${TOKEN}.json`
const acceptancePayload = report('mn06-acceptance', rows, {
  ran_at: new Date().toISOString(),
  token: TOKEN,
  git_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  regression_artifact_path: OUT,
  regression_exit: regression.code,
  regression_ran_at: artifact?.ran_at ?? null,
  pod1_before: before,
  pod1_after: after,
  deferred: ['生产切流/旧客户端', '物理 OS kill/真机', '云函数 sweeper 部署', 'S3ObjectBackend', 'fx lane', 'vision-dual https:'],
})
writeFileSync(resultPath, JSON.stringify(acceptancePayload))
console.log(`[acceptance] result: ${resultPath}`)
console.log(`\n${rows.length - failed.length}/9 rows PASS @ ${new Date().toISOString()}`)
if (failed.length > 0) process.exit(1)
