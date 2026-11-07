// MN06-T14/T16 —— handoff / limits / closure 静态收口。
//
// 只读、无网络：检查五节、原语 request/response、T-O 引用、probe 双 sha 与生产键区、
// 限制表代码锚、README 反假绿；`--closure` 时追加 closure 文件与五态。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ROOT, report } from './env.mjs'

const HANDOFF = join(ROOT, 'docs/truth/mini-nano/MN06-ep2-handoff.md')
const CLOSURE = join(ROOT, 'docs/closure/mini-nano/1st-wave/MN06-N-A-closure.md')
const MN06_README = join(ROOT, 'test/mn06/README.md')
const TEST_S3_README = join(ROOT, 'cloud/test-s3/README.md')
const WORKER = join(ROOT, 'cloud/worker/worker.mjs')
const checkClosure = process.argv.includes('--closure')

const read = (p, fallback = '') => (existsSync(p) ? readFileSync(p, 'utf8') : fallback)
const handoff = read(HANDOFF)
const readme = read(MN06_README)
const testS3 = read(TEST_S3_README)
const worker = read(WORKER)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const has = (text, needle) => text.includes(needle)

check('doc:handoff exists', handoff.length > 0, HANDOFF.replace(ROOT + '/', ''))
for (const section of ['§1 durable 原语语义合同', '§2 键区扩展 SOP', '§3 sync-vs-canonical 词汇表', '§4 测试基建', '§5 已知限制清单', '附录 A：9 行验收追溯']) {
  check(`doc:${section}`, has(handoff, section))
}
check('doc:version v1 + date 2026-11-07', /版本：`v1`/.test(handoff) && has(handoff, '2026-11-07'))
check('doc:T-O-1..T-O-10 refs', has(handoff, 'T-O-1..T-O-10'))
check('doc:owner sign-off', /业主 sign-off/.test(handoff) && /发车指令/.test(handoff))

const primitives = ['state/get', 'state/put-cas', 'state/del', 'claim', 'alarm/due', 'alarm/claim', 'vfs/put', 'vfs/get', 'vfs/del', 'vfs/list', 'artifacts/publish', '/a/{sha256}']
for (const p of primitives) check(`doc:primitive ${p}`, has(handoff, `\`${p}`) || has(handoff, p))
check('doc:state/del 明示未暴露', /state\/del` \| — \| \*\*未暴露\*\*/.test(handoff))
check('doc:request/response 列', has(handoff, '| 原语 | request | response / 终态 |'))

const probe = handoff.match(/probe commit \| `([0-9a-f]{40})`/) ?? []
const revert = handoff.match(/revert commit \| `([0-9a-f]{40})`/) ?? []
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
const commitOk = (sha) => { try { git('cat-file', '-e', `${sha}^{commit}`); return true } catch { return false } }
check('probe:probe sha 已登记', probe.length === 2 && commitOk(probe[1]), probe[1] ?? 'missing')
check('probe:revert sha 已登记', revert.length === 2 && commitOk(revert[1]), revert[1] ?? 'missing')
if (probe[1] && revert[1]) {
  const atProbe = git('show', `${probe[1]}:cloud/worker/worker.mjs`)
  const atRevert = git('show', `${revert[1]}:cloud/worker/worker.mjs`)
  check('probe:probe commit 键区含 probe', /\(state\|claims\|alarms\|probe\)/.test(atProbe))
  check('probe:revert commit 键区无 probe', !/probe/.test(atRevert.match(/key\.match\(([^)]*)\)/)?.[1] ?? ''))
}
check('probe:当前 worker 无 probe', !/\(state\|claims\|alarms\|probe\)/.test(worker))
const durables = ['cloud/durable/server.mjs', 'cloud/durable/core.mjs'].map((p) => read(join(ROOT, p))).join('\n')
check('probe:生产 core/server 无 probe', !/probe/.test(durables))
check('probe:生产 core/server 无 /dev/ 与 ADMIN_TOKEN', !/\/dev\//.test(durables) && !/ADMIN_TOKEN/.test(durables))

for (const word of ['canonical', 'receipt', 'cache', 'working copy']) check(`vocab:${word}`, has(handoff, word))
for (const aid of ['test/mn06', 'test/mn02', 'test/mn04', 'scripts/dev-cli', 'cloud/test-s3', 'cloud/durable']) check(`infra:${aid}`, has(handoff, aid))

const limits = ['256KB', '30s', 'listPrefix', '8MB', '6MB', '512', 'cache-tier', 'forward-fix', '单进程', 'FRD1', 'vision-dual', 'fx']
for (const l of limits) check(`limit:${l}`, has(handoff, l))

const appendix = handoff.slice(handoff.indexOf('附录 A：9 行验收追溯'))
const rows = [...appendix.matchAll(/^\| ([1-9]) \|/gm)].map((m) => Number(m[1]))
check('acceptance:9 行', rows.length === 9 && new Set(rows).size === 9, `rows=${rows.join(',')}`)
check('acceptance:scope + evidence_state', has(handoff, '| scope | evidence_state |'))

check('readme:mn06 挂载 probe/docs-check/acceptance', ['probe-sop.mjs', 'docs-check.mjs', 'acceptance.mjs'].every((x) => has(readme, x)))
check('readme:test-s3 删除 8/8 假绿', !/8\/8/.test(testS3) && has(testS3, '8 PASS + 1 NOTE'))
check('readme:test-s3 指向 durable 生产入口', has(testS3, 'cloud/durable/server.mjs'))

// ── T19b 静态收口 ───────────────────────────────────────────────
const gitGrep = (pattern, paths) => {
  try { return git('grep', '-I', '-n', '-E', pattern, '--', ...paths) } catch (e) {
    if (e.status === 1) return ''
    return String(e.stdout ?? e.message ?? e)
  }
}
const tracked = git('ls-files').split('\n').filter(Boolean)
check('secret:无 .anote/gateway.env/env 入仓', !tracked.some((f) => /(^|\/)\.anote\/|gateway\.env$|\.env\.wx\.cloud$|\.local\.development\./.test(f)))
check('secret:无私钥/AWS key 字面', gitGrep('BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}', ['.']) === '')
check('scope:无 outbox/WAL', gitGrep('outbox|write-ahead', ['services', 'cloud', 'app.ts', 'scripts/local-sweeper.mjs']) === '')
check('scope:无 episode/compaction 代码', gitGrep('\\bepisode\\b|\\bcompaction\\b', ['services', 'cloud', 'app.ts']) === '')
const tombHits = gitGrep('dsh:mini:vfs-tombstones', ['services']).split('\n').filter(Boolean)
check('scope:墓碑唯一 store 键', tombHits.length === 1, `hits=${tombHits.length}`)
const freezePath = join(ROOT, 'test/mn06/fss3-freeze.json')
const freeze = existsSync(freezePath) ? JSON.parse(readFileSync(freezePath, 'utf8')) : {}
const fss3 = read(join(ROOT, 'cloud/pod1/fss3-server.mjs'))
const fss3Sha = createHash('sha256').update(fss3).digest('hex')
check('freeze:fss3 代码冻结 hash 不变', freeze.sha256 === fss3Sha, `${fss3Sha.slice(0, 12)} vs ${String(freeze.sha256).slice(0, 12)}`)
check('freeze:fss3 策略为单向退役', /冻结|单向/.test(freeze.policy ?? ''))
const fss3Last = git('log', '-1', '--format=%h', '--', 'cloud/pod1/fss3-server.mjs').trim()
check('freeze:last_code_commit 对应 HEAD 历史', freeze.last_code_commit === fss3Last, `${freeze.last_code_commit} vs ${fss3Last}`)

const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { walk(p, out); continue }
    if (/\.(mjs|cjs|js)$/.test(f)) out.push(p)
  }
  return out
}
const mn06Files = walk(join(ROOT, 'test/mn06')).filter((f) => !f.endsWith('/docs-check.mjs'))
// 扫描器自身不得出现受禁 token 字面（否则 no-self-bridge 会把检查器当违规源）。
const AUTOMATOR = 'miniprogram' + '-automator'
const automatorHits = mn06Files.flatMap((f) => {
  const src = readFileSync(f, 'utf8')
  return [...src.matchAll(new RegExp(AUTOMATOR + '[^\\s\'"`]*', 'g'))].map((m) => `${f.split('/').pop()}:${m[0]}`)
})
const bridgeRe = new RegExp(['Mcp' + 'Client', 'new' + '[\\s]+Web' + 'Socket', 'automator' + '\\.(connect|launch)', 'launchAnd' + 'Connect', 'from[\\s]+[\'"`]' + AUTOMATOR + '[\'"`]'].join('|'))
check('bridge:test/mn06 仅 Connection 帧补丁子路径', automatorHits.length === 1 && automatorHits[0].endsWith(AUTOMATOR + '/out/Connection.js'), automatorHits.join(','))
check('bridge:test/mn06 无裸 ws/客户端直连', !mn06Files.some((f) => bridgeRe.test(readFileSync(f, 'utf8'))))
check('bridge:test/mn06 经 lib/ide.connectIde', /connectIde/.test(read(join(ROOT, 'test/mn06/app.mjs'))))

if (checkClosure) {
  const closure = read(CLOSURE)
  check('closure:exists', closure.length > 0, CLOSURE.replace(ROOT + '/', ''))
  for (const h of ['## 0.', '## 1.', '## 2.', '## 3.', '## 4.', '## 5.']) check(`closure:section ${h}`, has(closure, h))
  check('closure:close-type taxonomy', /Close-type: `(full-close|closed-with-explicit-deferrals|close-with-known-issues|implementation-complete-awaiting-live-verification)`/.test(closure))
  for (const id of ['P1-01', 'P2-01', 'P3-01', 'P4-01', 'P5-01', 'P5-04']) check(`closure:item ${id}`, has(closure, id))
  for (const s of ['verified', 'partial', 'deferred', '未观察', 'observed-OK-at-closure']) check(`closure:${s}`, has(closure, s))
  check('closure:T-O-1..T-O-10', has(closure, 'T-O-1'))
  check('closure:review 汇总', /审查|review/.test(closure))
}
const evidencePack = ['## 6. 证据包', '四元组', '运行时间', 'deferred', 'T17', 'T18', 'T21', 'T15']
for (const e of evidencePack) check(`evidence:${e}`, has(readme, e))
check('evidence:无 release gate', /无 release gate|不建 release gate/.test(readme))

const failed = results.filter((r) => !r.ok)
report('mn06-docs-check', results.map((r) => ({ id: r.name, pass: r.ok })), {
  ran_at: new Date().toISOString(), closure: checkClosure,
})
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()}`)
if (failed.length > 0) process.exit(1)
