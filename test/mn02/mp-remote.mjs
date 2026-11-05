// MN02-B2 mp 侧真源码 → POD1 真端点实验（pod1-live-public 级）。
// esbuild 现场打包 services/vfs/{vfs,remote,remote-sync,store,objects} 真源码，
// 跑在 wx-shim 上；post 通道 = 真 fetch 打 https://dsh-mini.haimang.com.cn。
// 覆盖：五根权限矩阵、写→镜像→远端行/对象、workspace 建立、session 挂载、
//       /mnt 投影、删除传播、冷启动 pull+hydrate（=G2 冷归档/热取回证据）、
//       artifacts publish 公网回环。
// 用法：TICKET=$(...) BASE=https://dsh-mini.haimang.com.cn node test/mn02/mp-remote.mjs
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const BASE = (process.env.BASE ?? 'https://dsh-mini.haimang.com.cn').replace(/\/$/, '')
const TICKET = process.env.TICKET ?? ''
if (!TICKET) { console.error('TICKET env required'); process.exit(2) }

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = require('esbuild')

const entry = join(mkdtempSync(join(tmpdir(), 'mn02-entry-')), 'entry.ts')
writeFileSync(entry, `
import { vfs } from '${repo}/services/vfs/vfs'
import { vfsStore } from '${repo}/services/vfs/store'
import { localObjects } from '${repo}/services/vfs/objects'
import { createRemoteVfs } from '${repo}/services/vfs/remote'
import { createVfsSync } from '${repo}/services/vfs/remote-sync'
export { vfs, vfsStore, localObjects, createRemoteVfs, createVfsSync }
`)
const out = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'cjs', write: false,
  platform: 'node', target: 'node18', logLevel: 'silent',
})
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { vfs, vfsStore, localObjects, createRemoteVfs, createVfsSync } = mod.exports

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const post = async (url, headers, body) => {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const remote = createRemoteVfs({ baseUrl: BASE, headers: () => ({ authorization: `Bearer ${TICKET}` }), post })
const sync = createVfsSync(remote)

const SID = `mn02-${Date.now().toString(36)}`
const RUN = SID // 远端命名空间隔离：行路径天然含 sid

// ── 五根权限矩阵（本地合同，先验后传）──────────────────────────────
vfs.write('/root/profile.ini', 'owner=mn02', { sessionId: SID })
vfs.write(`${'/data'}/${SID}/note.md`, '# hello pod1', { sessionId: SID })
vfs.write(`/data/${SID}/sub/deep.txt`, 'deep-file', { sessionId: SID })
vfs.write('/tmp/scratch.txt', 'ephemeral', { sessionId: SID })
const ro = (fn, code) => { try { fn(); return `NO-THROW` } catch (e) { return e.code === code ? code : `other:${e.code ?? e.message}` } }
check('root lane write ok', vfsStore.getRow('/root/profile.ini') !== undefined)
check('session lane write ok', vfsStore.getRow(`/data/${SID}/note.md`) !== undefined)
check('/mnt write → read-only-path', ro(() => vfs.write('/mnt/x', 'x', { sessionId: SID }), 'read-only-path'))
check('/backup write → read-only-path', ro(() => vfs.write('/backup/y', 'x', { sessionId: SID }), 'read-only-path'))
check('cross-session write → unsafe-workspace-path', ro(() => vfs.write('/data/other/v.txt', 'x', { sessionId: SID }), 'unsafe-workspace-path'))
check('escape path → unsafe-workspace-path', ro(() => vfs.write('/data/../etc', 'x', { sessionId: SID }), 'unsafe-workspace-path'))
check('6th root → unsafe-workspace-path', ro(() => vfs.write('/workspace/f', 'x', { sessionId: SID }), 'unsafe-workspace-path'))

// ── 镜像上行 ───────────────────────────────────────────────────────
{
  const rep = await sync.pushAll()
  check('pushAll pushed ≥3 durable rows', rep.pushed.length >= 3 && rep.failed.length === 0, `pushed=${rep.pushed.length} failed=${rep.failed.length}`)
  const rows = await remote.list('rows/')
  check('remote rows contain session+hub paths', rows.includes(`rows/data/${SID}/note.md`) && rows.includes('rows/root/profile.ini'), rows.filter((k) => k.includes(SID) || k.includes('profile')).join(','))
  check('scratch row NOT mirrored', !rows.some((k) => k.includes('scratch.txt')), '/tmp 不上线')
  const objs = await remote.list('objects/')
  check('remote objects ≥3', objs.filter((k) => k.startsWith('objects/')).length >= 3, `${objs.length} keys`)
  // 对象字节回读校验（content-addressed 真源语义）
  const row = vfsStore.getRow(`/data/${SID}/note.md`)
  const g = await remote.get(`objects/${row.object_key}`)
  check('remote object bytes roundtrip', g !== null && Buffer.from(g.bytes).toString('utf8') === '# hello pod1')
}

// ── workspace 建立 + session 挂载 + /mnt 投影 ──────────────────────
{
  await sync.createWorkspace('ws-exp')
  check('local mount row created', vfsStore.getMount('ws-exp') !== undefined)
  await sync.mountSession('ws-exp', SID)
  const mount = vfsStore.getMount('ws-exp')
  check('mount sessions contains sid', mount?.sessions.includes(SID) === true)
  const mkeys = await remote.list('workspaces/')
  check('remote workspace manifest + mount row', mkeys.includes('workspaces/ws-exp.json') && mkeys.includes(`workspaces/ws-exp/sessions/${SID}.json`), mkeys.filter((k) => k.includes('ws-exp')).join(','))
  const mlist = vfs.list('/mnt', { sessionId: SID })
  check('/mnt lists workspace', mlist.entries.some((e) => e.path === '/mnt/ws-exp' && e.kind === 'dir'), JSON.stringify(mlist.entries))
  const wlist = vfs.list('/mnt/ws-exp', { sessionId: SID })
  check('/mnt/ws-exp lists mounted session', wlist.entries.some((e) => e.path === `/mnt/ws-exp/${SID}`))
  check('/mnt stat mounted session dir', vfs.stat(`/mnt/ws-exp/${SID}`, { sessionId: SID }).kind === 'dir')
  check('/mnt unknown → none', vfs.stat('/mnt/ghost', { sessionId: SID }).exists === false)
}

// ── 冷启动：清空本地 cache-tier → pull + hydrate 取回 ───────────────
{
  const objsRoot = join(globalThis.wx.env.USER_DATA_PATH, 'dsh-vfs', 'objects')
  rmSync(objsRoot, { recursive: true, force: true })
  for (const r of [...vfsStore.allRows()]) vfsStore.removeRow(r.virtual_path)
  for (const m of [...vfsStore.allMounts()]) vfsStore.removeMount(m.name)
  check('local rows+mounts wiped', vfsStore.allRows().length === 0 && vfsStore.allMounts().length === 0)

  const pulled = await sync.pullRows()
  check('pullRows restores durable rows', pulled.includes(`/data/${SID}/note.md`) && pulled.includes('/root/profile.ini'), `${pulled.length} pulled`)
  const missing = localObjects.exists(vfsStore.getRow(`/data/${SID}/note.md`).object_key) === false
  check('bytes absent before hydrate', missing === true)
  const h = await sync.hydrate(`/data/${SID}/note.md`)
  check('hydrate restores bytes', h === true && vfs.read(`/data/${SID}/note.md`, { sessionId: SID }).text === '# hello pod1')
  const wss = await sync.pullWorkspaces()
  check('pullWorkspaces rebuilds /mnt', wss.includes('ws-exp') && vfsStore.getMount('ws-exp')?.sessions.includes(SID) === true)
}

// ── 删除传播 ───────────────────────────────────────────────────────
{
  vfs.remove('/root/profile.ini', { sessionId: SID })
  await sync.pushRemove('/root/profile.ini')
  const rows = await remote.list('rows/')
  check('pushRemove deletes remote row', !rows.includes('rows/root/profile.ini'))
}

// ── artifacts 公网出口（publish → 无鉴权 GET 字节级回环）─────────────
{
  const bytes = new TextEncoder().encode('mn02-artifact-payload').buffer
  const pub = await remote.publishArtifact(bytes, 'text/plain')
  check('publishArtifact → url', typeof pub.url === 'string' && pub.url.includes('/a/'))
  const get = await fetch(pub.url)
  const body = Buffer.from(await get.arrayBuffer())
  check('public artifact GET bytes match', get.status === 200 && body.toString('utf8') === 'mn02-artifact-payload')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}  sid=${SID} base=${BASE}`)
process.exit(failed.length === 0 ? 0 : 1)
