// L1（Node）：diag v2 模式分派——默认 v1 契约不动；full:true → v2 + 三增量段。
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const esp = createRequire(join(repo, 'test/spike/package.json'))
const esbuild = esp('esbuild')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`) }

const bundle = async (entry) => {
  const dir = mkdtempSync(join(tmpdir(), 'mn04-'))
  const ent = join(dir, 'entry.ts')
  writeFileSync(ent, entry)
  const out = await esbuild.build({ entryPoints: [ent], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(join(repo, 'package.json')))
  return mod.exports
}

const { sessionDiagnostics, DIAG_SCHEMA, DIAG_SCHEMA_V2, errorBus } = await bundle(
  `import { sessionDiagnostics, DIAG_SCHEMA, DIAG_SCHEMA_V2 } from '${repo}/services/diagnostics';
   import { errorBus } from '${repo}/services/error-report';
   export { sessionDiagnostics, DIAG_SCHEMA, DIAG_SCHEMA_V2, errorBus }`,
)

// V1：默认调用契约不变
{
  const b = sessionDiagnostics()
  check('V1: 默认 schema=v1', b.schema === 'dsh-mini.diag.v1' && DIAG_SCHEMA === 'dsh-mini.diag.v1')
  check('V1: storage/vfs.objects/errors.all 缺席', b.storage === undefined && b.vfs.objects === undefined && b.errors.all === undefined)
}

// V2：full:true → schema=v2 + 三增量段
{
  wx.setStorageSync('mn04-v2-probe', { probe: 1 })
  errorBus.clear()
  errorBus.report(new Error('v2 probe error'), { op: 'diag-v2' })
  const b = sessionDiagnostics(undefined, true)
  check('V2: schema=v2', b.schema === 'dsh-mini.diag.v2' && DIAG_SCHEMA_V2 === 'dsh-mini.diag.v2')
  check('V2: storage.all 存在且含键', typeof b.storage?.all === 'object' && 'mn04-v2-probe' in b.storage.all, `keys=${Object.keys(b.storage?.all ?? {}).length}`)
  check('V2: vfs.objects 存在', Array.isArray(b.vfs?.objects))
  check('V2: errors.all 存在且含新报错误', Array.isArray(b.errors?.all) && b.errors.all.some((r) => r.message?.includes('v2 probe error') || r.raw?.message?.includes('v2 probe error')))
  check('V2: errors.recent 仍 ≤20', b.errors.recent.length <= 20)
  wx.removeStorageSync('mn04-v2-probe')
}

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
