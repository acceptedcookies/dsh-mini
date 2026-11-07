// MN06-T04..T07 —— 删除意图：tombstone store / vfs.remove 事务 / recover LWW / pendingSummary。
//
// 单元 + 本地集成（wx-shim），不触远端。组：--unit --remove --recover --summary；
// 默认全跑。输出 PASS/FAIL，失败非 0。
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')
const require = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = require('esbuild')

const entry = join(mkdtempSync(join(tmpdir(), 'mn06-tomb-')), 'entry.ts')
writeFileSync(entry, `
import * as tomb from '${repo}/services/vfs/tombstone'
import { vfs, setVfsMirrorHook, setVfsMirrorPredicate } from '${repo}/services/vfs/vfs'
import { vfsStore } from '${repo}/services/vfs/store'
import { createVfsSync, recoverPendingDeletes, pendingSummary } from '${repo}/services/vfs/remote-sync'
export { tomb, vfs, setVfsMirrorHook, setVfsMirrorPredicate, vfsStore, createVfsSync, recoverPendingDeletes, pendingSummary }
`)
const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent' })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { tomb, vfs, setVfsMirrorHook, setVfsMirrorPredicate, vfsStore, createVfsSync, recoverPendingDeletes, pendingSummary } = mod.exports

const args = process.argv.slice(2)
const want = (g) => args.length === 0 || args.includes(`--${g}`)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const TOMB_KEY = 'dsh:mini:vfs-tombstones'
const SYNC_KEY = 'dsh:vfs:v1:sync'
const ROWS_KEY = 'dsh:vfs:v1:rows'
const clearAll = () => { wx.removeStorageSync(TOMB_KEY); wx.removeStorageSync(SYNC_KEY); wx.removeStorageSync(ROWS_KEY) }
const row = (path, updated_ms, extra = {}) => ({
  virtual_path: path, object_key: 'ab'.repeat(32), content_hash: `sha256:${'ab'.repeat(32)}`,
  size_bytes: 1, mime: 'text/plain', placement: 'local-hub', lane: 'hub', committed: true, updated_ms, ...extra,
})
const sid = `mn06tomb-${Date.now().toString(36)}`

// ── unit ──────────────────────────────────────────────────────────────
if (want('unit')) {
  clearAll()
  tomb.beginDelete('/data/x/a')
  check('unit:begin → pending', tomb.phaseOf(tomb.allTombstones()['/data/x/a']) === 'pending')
  const at = tomb.atMs(tomb.allTombstones()['/data/x/a'])
  check('unit:begin at_ms > 0', at > 0, `at=${at}`)
  tomb.commitDelete('/data/x/a')
  check('unit:commit → committed 保留 at_ms', tomb.phaseOf(tomb.allTombstones()['/data/x/a']) === 'committed' && tomb.atMs(tomb.allTombstones()['/data/x/a']) === at)
  tomb.abortDelete('/data/x/a')
  check('unit:abort 不清 committed', tomb.allTombstones()['/data/x/a'] !== undefined)
  tomb.beginDelete('/data/x/b')
  tomb.abortDelete('/data/x/b')
  check('unit:abort 清 pending', tomb.allTombstones()['/data/x/b'] === undefined)
  wx.setStorageSync(TOMB_KEY, { '/legacy/p': 12345 })
  check('unit:legacy 数字按 committed + atMs', tomb.phaseOf(tomb.allTombstones()['/legacy/p']) === 'committed' && tomb.atMs(tomb.allTombstones()['/legacy/p']) === 12345)
  clearAll()
  for (let i = 0; i < 520; i += 1) tomb.setTomb(`/cap/${i}`)
  const capKeys = Object.keys(tomb.allTombstones())
  check('unit:512 上限淘汰最旧', capKeys.length === 512 && tomb.allTombstones()['/cap/0'] === undefined && tomb.allTombstones()['/cap/519'] !== undefined, `count=${capKeys.length}`)
}

// ── remove 事务 ───────────────────────────────────────────────────────
if (want('remove')) {
  clearAll()
  const path = `/data/${sid}/r1.txt`
  vfs.write(path, 'r1', { sessionId: sid })
  const ok = vfs.remove(path, { sessionId: sid })
  const t = tomb.allTombstones()[path]
  check('remove:成功删除后 row 消失', ok === true && vfsStore.getRow(path) === undefined)
  check('remove:成功删除后碑 committed', t !== undefined && tomb.phaseOf(t) === 'committed')

  // begin 失败 → remove 中止，row 仍在
  const path2 = `/data/${sid}/r2.txt`
  vfs.write(path2, 'r2', { sessionId: sid })
  const origSet = wx.setStorageSync
  let threw = null
  wx.setStorageSync = (k, v) => { if (k === TOMB_KEY) throw new Error('quota-boom'); return origSet(k, v) }
  try { vfs.remove(path2, { sessionId: sid }) } catch (e) { threw = e }
  wx.setStorageSync = origSet
  check('remove:begin 失败 → 抛错且 row 未删', threw !== null && vfsStore.getRow(path2) !== undefined, String(threw?.message ?? 'no-throw'))

  // removeRow 失败 → abort pending
  const path3 = `/data/${sid}/r3.txt`
  vfs.write(path3, 'r3', { sessionId: sid })
  const origRemove = vfsStore.removeRow
  vfsStore.removeRow = () => { throw new Error('row-boom') }
  let threw3 = null
  try { vfs.remove(path3, { sessionId: sid }) } catch (e) { threw3 = e }
  vfsStore.removeRow = origRemove
  check('remove:removeRow 失败 → abort 清 pending', threw3 !== null && tomb.allTombstones()[path3] === undefined, String(threw3?.message ?? 'no-throw'))

  // commit 失败 → 保留 pending，row 已删
  const path4 = `/data/${sid}/r4.txt`
  vfs.write(path4, 'r4', { sessionId: sid })
  let tombWrites = 0
  const origSet2 = wx.setStorageSync
  wx.setStorageSync = (k, v) => {
    if (k === TOMB_KEY) { tombWrites += 1; if (tombWrites === 2) throw new Error('commit-boom') }
    return origSet2(k, v)
  }
  let threw4 = null
  try { vfs.remove(path4, { sessionId: sid }) } catch (e) { threw4 = e }
  wx.setStorageSync = origSet2
  const t4 = tomb.allTombstones()[path4]
  check('remove:commit 失败 → row 已删且碑保留 pending', threw4 === null && vfsStore.getRow(path4) === undefined && t4 !== undefined && tomb.phaseOf(t4) === 'pending', `tombWrites=${tombWrites}`)

  // mirrorHook 在 commit 后抛错 → 碑不被 abort
  const path5 = `/data/${sid}/r5.txt`
  vfs.write(path5, 'r5', { sessionId: sid })
  setVfsMirrorHook(() => { throw new Error('hook-boom') })
  let threw5 = null
  try { vfs.remove(path5, { sessionId: sid }) } catch (e) { threw5 = e }
  setVfsMirrorHook(undefined)
  const t5 = tomb.allTombstones()[path5]
  check('remove:commit 后 hook 抛错 → 碑仍 committed', threw5 === null && t5 !== undefined && tomb.phaseOf(t5) === 'committed')

  // mirror predicate=false → 不落碑
  const path6 = `/data/${sid}/r6.txt`
  vfs.write(path6, 'r6', { sessionId: sid })
  setVfsMirrorPredicate((p) => p !== path6)
  vfs.remove(path6, { sessionId: sid })
  setVfsMirrorPredicate(undefined)
  check('remove:非镜像 lane 不落碑', tomb.allTombstones()[path6] === undefined)

  // /tmp scratch 不落碑
  const tmp = `/tmp/${sid}-s.txt`
  vfs.write(tmp, 's', { sessionId: sid })
  vfs.remove(tmp, { sessionId: sid })
  check('remove:/tmp scratch 不落碑', tomb.allTombstones()[tmp] === undefined)
}

// ── recover LWW ───────────────────────────────────────────────────────
if (want('recover')) {
  clearAll()
  const a = `/data/${sid}/a.txt`
  const b = `/data/${sid}/b.txt`
  const c = `/data/${sid}/c.txt`
  vfsStore.putRow(row(a, 100))
  vfsStore.putRow(row(b, 300))
  wx.setStorageSync(TOMB_KEY, {
    [a]: { at_ms: 200, phase: 'pending' },
    [b]: { at_ms: 200, phase: 'pending' },
    [c]: { at_ms: 200, phase: 'pending' },
  })
  const rec = recoverPendingDeletes()
  check('recover:旧 row 补删 + 标 committed', rec.removed.includes(a) && vfsStore.getRow(a) === undefined && tomb.phaseOf(tomb.allTombstones()[a]) === 'committed')
  check('recover:新 row 保留 + 清碑（LWW）', rec.kept.includes(b) && vfsStore.getRow(b) !== undefined && tomb.allTombstones()[b] === undefined)
  check('recover:本地无 row → 标 committed', tomb.phaseOf(tomb.allTombstones()[c]) === 'committed')
  const rec2 = recoverPendingDeletes()
  check('recover:幂等（再跑无变化）', rec2.removed.length === 0 && rec2.kept.length === 0)

  // 旧数字碑按 committed 参与 pullRows 重删；远端新于碑则 LWW 复活。
  clearAll()
  const d = `/data/${sid}/d.txt`
  const deleted = []
  const bytes = (o) => new TextEncoder().encode(JSON.stringify(o)).buffer
  let remoteRow = row(d, 100)
  const fakeRemote = {
    async list() { return [`rows/data/${sid}/d.txt`] },
    async get(key) { return key.startsWith('rows/') ? { bytes: bytes(remoteRow), etag: 'e1' } : null },
    async del(key) { deleted.push(key) },
    async put() { return { etag: 'e2' } },
  }
  const sync = createVfsSync(fakeRemote)
  wx.setStorageSync(TOMB_KEY, { [d]: 150 })
  const pulled = await sync.pullRows()
  check('recover:legacy 数字碑 → pullRows 不复活 + 重删', !pulled.includes(d) && vfsStore.getRow(d) === undefined && deleted.includes(`rows/data/${sid}/d.txt`))
  remoteRow = row(d, 500)
  const pulled2 = await sync.pullRows()
  check('recover:远端新于碑 → LWW 复活', pulled2.includes(d) && vfsStore.getRow(d) !== undefined && tomb.allTombstones()[d] === undefined)
}

// ── pendingSummary ────────────────────────────────────────────────────
if (want('summary')) {
  clearAll()
  vfsStore.putRow(row('/root/synced.txt', 100))
  vfsStore.putRow(row('/root/unsynced.txt', 200))
  vfsStore.putRow(row('/root/noptr.txt', 50))
  vfsStore.putRow(row('/tmp/scratch.txt', 999, { placement: 'local-scratch', lane: 'scratch' }))
  vfsStore.putRow(row('/root/uncommitted.txt', 999, { committed: false }))
  wx.setStorageSync(SYNC_KEY, { '/root/synced.txt': { etag: 'e', synced_ms: 100 }, '/root/unsynced.txt': { etag: 'e', synced_ms: 100 } })
  wx.setStorageSync(TOMB_KEY, { '/root/del-p': { at_ms: 10, phase: 'pending' }, '/root/del-c': { at_ms: 20, phase: 'committed' } })
  const s1 = pendingSummary()
  check('summary:排除 scratch/未提交；指针判 unsynced', s1.unsynced_rows === 2 && s1.tombstones.pending === 1 && s1.tombstones.committed === 1 && s1.total === 4, JSON.stringify(s1))
  vfsStore.putRow(row('/root/extra.txt', 300))
  const s2 = pendingSummary()
  check('summary:新增 row 前后差随动', s2.unsynced_rows === s1.unsynced_rows + 1, JSON.stringify(s2))
  const ptr = wx.getStorageSync(SYNC_KEY)
  ptr['/root/extra.txt'] = { etag: 'e', synced_ms: 300 }
  wx.setStorageSync(SYNC_KEY, ptr)
  const s3 = pendingSummary()
  check('summary:补指针后回落', s3.unsynced_rows === s1.unsynced_rows, JSON.stringify(s3))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS @ ${new Date().toISOString()}`)
if (failed.length > 0) process.exit(1)
