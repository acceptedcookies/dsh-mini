// MN01-T03/T08 surface 测试：wx shim 下驱动真服务源码（esbuild 现场打包）。
// - localCas：CAS 412 矩阵、claim 接管、索引列举
// - tool-surface：file_write/file_read/file_stat/file_list/file_remove 经共享层真跑 VFS
// - remote-cas：线键映射 {kind}/{rest} ↔ dsh-mini/{kind}/{owner}/{rest}（注入 post 替身）
// 用法：node test/mn01/surface.mjs
import './wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = require('esbuild')

// 测试入口：打包 services 真源码（TS→CJS），跑在 wx-shim 上
const entry = join(mkdtempSync(join(tmpdir(), 'mn01-entry-')), 'entry.ts')
writeFileSync(entry, `
import { localCas, localCasReset } from '${repo}/services/state/local-cas'
import { createRemoteCas } from '${repo}/services/state/remote-cas'
import { runFileTool } from '${repo}/services/vfs/tool-surface'
export { localCas, localCasReset, createRemoteCas, runFileTool }
`)
const out = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'cjs', write: false,
  platform: 'node', target: 'node18', logLevel: 'silent',
})
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { localCas, localCasReset, createRemoteCas, runFileTool } = mod.exports

const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`) }

// ── localCas CAS 矩阵
localCasReset()
check('cas:put-ifNoneMatch', (await localCas.putCas('k1', 'v1', { ifNoneMatch: '*' })).status === 200, 'new key 200')
check('cas:dup-412', (await localCas.putCas('k1', 'v2', { ifNoneMatch: '*' })).status === 412, 'dup If-None-Match:* → 412')
const g1 = await localCas.get('k1')
check('cas:get', g1?.body === 'v1' && typeof g1.etag === 'string', `etag=${g1?.etag}`)
check('cas:match-ok', (await localCas.putCas('k1', 'v2', { ifMatch: g1.etag })).status === 200, 'If-Match 200')
check('cas:stale-412', (await localCas.putCas('k1', 'v3', { ifMatch: g1.etag })).status === 412, 'stale etag → 412')
check('cas:listPrefix', (await localCas.listPrefix('k')).includes('k1'), 'index 列举命中')
await localCas.del('k1')
check('cas:del', (await localCas.get('k1')) === null, 'del 后 404')

// ── tool-surface 真 VFS 往返（session 作用域 /data/{sid}）
const SID = 'ts1'
const w = runFileTool('file_write', { path: 'a.txt', content: 'hello-mn01' }, SID)
check('tool:write', !w.isError, w.content.slice(0, 80))
const r = runFileTool('file_read', { path: 'a.txt' }, SID)
check('tool:read', !r.isError && r.content.includes('hello-mn01'), r.content.slice(0, 80))
const st = runFileTool('file_stat', { path: 'a.txt' }, SID)
check('tool:stat', !st.isError && st.content.includes('"exists":true'), st.content.slice(0, 80))
const ls = runFileTool('file_list', { path: '.' }, SID)
check('tool:list', !ls.isError && ls.content.includes('a.txt'), ls.content.slice(0, 80))
const rm = runFileTool('file_remove', { path: 'a.txt' }, SID)
check('tool:remove', !rm.isError && rm.content.includes('"removed":true'), rm.content)
const rm2 = runFileTool('file_remove', { path: 'a.txt' }, SID)
check('tool:remove-idempotent-false', rm2.content.includes('"removed":false'), '二态字段（写工具不可逐字节比对——T03 纪律）')
const bad = runFileTool('file_read', { path: '/etc/passwd' }, SID)
check('tool:err-shape', bad.isError && bad.content.includes('"error"'), bad.content.slice(0, 60))

// ── remote-cas 线键映射（注入 post 替身抓线格式）
{
  const sent = []
  const cas = createRemoteCas({
    baseUrl: 'http://x', prefix: '/sim/v1', owner: 'o9',
    post: async (url, _h, body) => { sent.push({ url, body }); 
      const ep = url.split('/sim/v1/')[1]
      if (ep === 'state/get') return { status: 404, body: {} }
      if (ep === 'state/put-cas') return { status: 200, body: { etag: 'e1' } }
      if (ep === 'alarm/due') return { status: 200, body: { keys: ['alarms/1-s1'] } }
      return { status: 500, body: {} }
    },
  })
  await cas.get('dsh-mini/state/o9/s1')
  check('wire:get', sent[0].body.key === 'state/s1', `sent key=${sent[0].body.key}（openid 已剥离待服务端注入）`)
  await cas.putCas('dsh-mini/claims/o9/s1', 'b', {})
  check('wire:put-claims', sent[1].body.key === 'claims/s1', `sent key=${sent[1].body.key}`)
  const alarms = await cas.listPrefix('dsh-mini/alarms/o9/')
  check('wire:alarm-list', alarms[0] === 'dsh-mini/alarms/o9/1-s1', `mapped back → ${alarms[0]}`)
  const big = 'x'.repeat(300 * 1024)
  check('wire:256kb-limit', (await cas.putCas('dsh-mini/state/o9/s1', big, {})).status === 413, '>256KB → 413')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`)
process.exit(failed.length === 0 ? 0 : 1)
