// nano-embed spike bundler: esbuild + @haimang/* alias → context/nano-agent TS 源.
// context/ 只读：不安装、不写产物进参考系。
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '../../../..')            // dsh-mini
export const NANO = path.join(REPO, 'context/nano-agent')        // 参考系（只读）
export const PKGS = path.join(NANO, 'packages')
export const WORKERS = path.join(NANO, 'workers')
export const OUT = path.join(HERE, '../out')

// @haimang/<pkg>[/<sub>] → packages/<pkg>/src/<sub|index>.ts
// workspace 包定位：packages/<pkg> 或 workers/<pkg>；exports 映射 dist/x.js→src/x.ts
const pkgCache = new Map()
const NAME2DIR = (() => {
  const m = new Map()
  for (const root of [PKGS, WORKERS]) {
    for (const dir of fs.readdirSync(root)) {
      const pj = path.join(root, dir, 'package.json')
      try {
        const name = JSON.parse(fs.readFileSync(pj, 'utf8')).name
        if (name) m.set(name, path.join(root, dir))
      } catch { /* no package.json */ }
    }
  }
  return m
})()
function resolveSpec(fullName, subpath) {
  const dir = NAME2DIR.get(fullName)
  if (!dir) return null
  const sub = subpath || '.'
  const pj = pkgCache.get(fullName) ?? JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  pkgCache.set(fullName, pj)
  // 1) exports 映射
  const exp = pj.exports?.[sub] ?? pj.exports?.[sub === '.' ? '.' : `./${sub}`]
  const target = typeof exp === 'string' ? exp : exp?.import ?? exp?.require ?? exp?.types
  if (target) {
    const rel = target.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.js$/, '.ts').replace(/\.d\.ts$/, '.ts')
    const cand = path.join(dir, rel)
    if (fs.existsSync(cand)) return cand
  }
  // 2) 裸路径回退
  const s = sub === '.' ? 'index' : sub
  for (const cand of [
    path.join(dir, 'src', `${s}.ts`), path.join(dir, 'src', s, 'index.ts'),
    path.join(dir, `${s}.ts`), path.join(dir, s, 'index.ts'),
  ]) {
    if (fs.existsSync(cand)) return cand
  }
  return null
}

const haimang = {
  name: 'haimang-workspace',
  setup(build) {
    build.onResolve({ filter: /^@(haimang|nano-agent)\// }, (args) => {
      const [ns, pkg, ...rest] = args.path.split('/')
      const found = resolveSpec(`${ns}/${pkg}`, rest.join('/'))
      return found
        ? { path: found }
        : { errors: [{ text: `unresolved workspace spec ${args.path}` }] }
    })
  },
}

export async function bundleTier({ name, entries, minify = true, external = [], banner = '' }) {
  fs.mkdirSync(OUT, { recursive: true })
  const result = await esbuild.build({
    entryPoints: entries,
    banner: banner ? { js: banner } : undefined,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2020',
    minify,
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins: [haimang],
    external: [...external, 'node:*', 'cloudflare:*'],
    nodePaths: [path.join(HERE, '../../node_modules')],
    // 小程序无 node 内建：全部按 external 记缺口而非失败
    mainFields: ['module', 'main'],
  }).catch((e) => ({ errors: e.errors ?? [{ text: String(e) }] }))

  if (result.errors?.length) {
    return { name, ok: false, errors: result.errors.map((e) => e.text) }
  }
  const out = result.outputFiles[0]
  fs.writeFileSync(path.join(OUT, `${name}.cjs`), out.contents)
  const inputs = Object.entries(result.metafile.inputs).map(([file, v]) => ({
    file: path.relative(NANO, file),
    bytes: v.bytes,
  })).sort((a, b) => b.bytes - a.bytes)
  return {
    name,
    ok: true,
    bytes_raw: out.contents.length,
    files: inputs.length,
    inputs,
    warnings: result.warnings?.map((w) => w.text) ?? [],
  }
}

// API 表面扫描：对产物做正则计数，给出 JSC 可用性分类
const SURFACE = [
  // 小程序 JSC 有
  ['jsc:TextEncoder', /\bTextEncoder\b/g],
  ['jsc:TextDecoder', /\bTextDecoder\b/g],
  ['jsc:URL', /\bnew URL\(/g],
  ['jsc:JSON', /\bJSON\./g],
  ['jsc:Promise', /\bPromise\./g],
  ['jsc:setTimeout', /\bsetTimeout\b/g],
  // JSC 缺但可 polyfill（我们已有实现）
  ['polyfillable:crypto.subtle', /crypto\.subtle/g],
  ['polyfillable:atob/btoa', /\b(atob|btoa)\(/g],
  ['polyfillable:queueMicrotask', /\bqueueMicrotask\b/g],
  // 需 I/O 重接（fetch→wx.request/proxy）
  ['io:fetch', /\bfetch\(/g],
  ['io:WebSocket', /\bWebSocket\b/g],
  ['io:ReadableStream', /\bReadableStream\b/g],
  ['io:AbortController', /\bAbortController\b/g],
  ['io:Response', /\bnew Response\(/g],
  ['io:Request', /\bnew Request\(/g],
  // 硬缺口（workers/node 专属）
  ['hard:workers-env', /\benv\.\w+/g],
  ['hard:DurableObject', /\bDurableObject\w*\b/g],
  ['hard:WebSocketPair', /\bWebSocketPair\b/g],
  ['hard:node-process', /\bprocess\.\w+/g],
  ['hard:node-Buffer', /\bBuffer\b/g],
  ['hard:node-import', /require\(["']node:/g],
  ['hard:structuredClone', /\bstructuredClone\b/g],
  ['hard:navigator', /\bnavigator\./g],
  ['hard:document', /\bdocument\./g],
  ['hard:localStorage', /\blocalStorage\b/g],
]

export function scanSurface(file) {
  const src = fs.readFileSync(file, 'utf8')
  const hits = {}
  for (const [label, re] of SURFACE) {
    const n = (src.match(re) ?? []).length
    if (n) hits[label] = n
  }
  return hits
}
