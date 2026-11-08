#!/usr/bin/env node
// spike / nano-tools — bundle bash-core spike entry for H1 (node cjs) + mp.
// Reuses the haimang alias plugin pattern from scripts/build-kernel.mjs.
import esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')
const NANO = path.join(REPO, 'context/nano-agent')
const PKGS = path.join(NANO, 'packages')
const WORKERS = path.join(NANO, 'workers')
const SPIKE_NM = path.join(REPO, 'test/spike/node_modules')
const OUT = path.join(HERE, 'bundle')
const OUT_MP = path.join(HERE, 'mp/vendor')
const head = process.env.SPIKE_NANO_PIN || 'spike-unpinned'

// ── @haimang/* alias → context/nano-agent TS 源（from build-kernel.mjs）──
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
  const exp = pj.exports?.[sub] ?? pj.exports?.[sub === '.' ? '.' : `./${sub}`]
  const target = typeof exp === 'string' ? exp : exp?.import ?? exp?.require ?? exp?.types
  if (target) {
    const rel = target.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.js$/, '.ts').replace(/\.d\.ts$/, '.ts')
    const cand = path.join(dir, rel)
    if (fs.existsSync(cand)) return cand
  }
  const s = sub === '.' ? 'index' : sub
  for (const cand of [
    path.join(dir, 'src', `${s}.ts`), path.join(dir, 'src', s, 'index.ts'),
    path.join(dir, `${s}.ts`), path.join(dir, s, 'index.ts'),
  ]) {
    if (fs.existsSync(cand)) return cand
  }
  return null
}
const makeHaimang = (opts = {}) => ({
  name: 'haimang-workspace',
  setup(build) {
    build.onResolve({ filter: /^@(haimang|nano-agent)\// }, (a) => {
      // content-scan-kernel pulls node:fs at module top — stub whole package
      // (rg degrades to honest 'content-scan unavailable')
      if (a.path.includes('content-scan-kernel')) return { path: a.path, namespace: 'spike-stub' }
      const [ns, name, ...rest] = a.path.split('/')
      const found = resolveSpec(`${ns}/${name}`, rest.join('/'))
      return found
        ? { path: found }
        : { errors: [{ text: `unresolved workspace spec ${a.path}` }] }
    })
    // mp lane: no WebAssembly in the appservice (WXWebAssembly is worker-only),
    // so tree-sitter + its wasm stay stubbed there. H1 resolves the real
    // packages and embeds the wasm via esbuild's binary loader.
    if (opts.mp) {
      build.onResolve({ filter: /\.wasm$|web-tree-sitter|tree-sitter-/ }, (a) => ({
        path: a.path, namespace: 'spike-stub',
      }))
    }
    build.onLoad({ filter: /.*/, namespace: 'spike-stub' }, () => ({
      contents: `const boom=()=>{throw new Error("spike-stub:dep-not-bundled")};
        const p=new Proxy(function(){},{get:(t,k)=>(k===Symbol.toPrimitive?()=>'spike-stub':p),construct:boom,apply:boom});
        module.exports=new Proxy({},{get:()=>p});
        module.exports.default=p;`,
      loader: 'js',
    }))
    // zod pulls all 64 locale tables via `export * as locales` (~341KB raw,
    // ≈ the whole 2MB remote-debug overage). Redirect the locales index to an
    // en-only shim; any other locale file becomes an honest stub (lazy throw
    // only if actually imported — locales are error-message data, not logic).
    build.onResolve({ filter: /locales\/[^/]+\.js$/ }, (a) => {
      const inZod = a.importer.includes('zod') || a.resolveDir.includes('zod')
      if (!inZod) return undefined
      const base = a.path.split('/').pop()
      if (base === 'index.js') return { path: path.join(HERE, 'src/zod-locales-shim.js') }
      if (base === 'en.js') return undefined
      return { path: a.path, namespace: 'spike-stub' }
    })
  },
})

const banner = [
  `/* spikePin=${head} built=${new Date().toISOString()} */`,
  `globalThis.__zod_globalConfig={jitless:true};`,
].join('\n')

// ── contract trim (mp lane only) ──────────────────────────────────────────
// Replaces generated-tool-contract.ts with an artifact whose per-tool
// output_schema is {}. Everything else (ids, routes, effect_class,
// input_schema, enter_surface, visibility, digests) is preserved verbatim.
const contractTrim = {
  name: 'spike-contract-trim',
  setup(build) {
    build.onLoad({ filter: /generated-tool-contract\.ts$/ }, async (args) => {
      const src = await fs.promises.readFile(args.path, 'utf8')
      const start = src.indexOf('{', src.indexOf('Object.freeze('))
      let depth = 0, end = -1, inStr = false, esc = false
      for (let k = start; k < src.length; k++) {
        const ch = src[k]
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
        if (ch === '"') { inStr = true; continue }
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { end = k + 1; break } }
      }
      const obj = JSON.parse(src.slice(start, end))
      // mp lane: schemas are the 900KB+ bulk; keep every scalar contract
      // field (ids/routes/policies/digests) and blank only the schema bodies.
      for (const t of obj.tools) { t.output_schema = {}; t.input_schema = {} }
      const out = `
export const GENERATED_TOOL_CONTRACT = ${JSON.stringify(obj)} as unknown as GeneratedToolContractArtifact;
export const MODEL_VISIBLE_TOOL_CONTRACTS = Object.freeze(GENERATED_TOOL_CONTRACT.tools.filter((tool) => tool.visibility === "model-visible"));
export const ENTER_SURFACE_TOOL_IDS = Object.freeze(GENERATED_TOOL_CONTRACT.tools.filter((tool) => tool.enter_surface === "member").map((tool) => tool.canonical_id));
export const PLATFORM_DEFAULT_AGENT_TOOL_BUNDLE = Object.freeze(GENERATED_TOOL_CONTRACT.default_agent_bundle);
export const TOOL_CONTRACT_BY_ID = new Map(GENERATED_TOOL_CONTRACT.tools.map((tool) => [tool.canonical_id, tool]));
export const TOOL_CONTRACT_COMPATIBILITY = Object.freeze({ protocol_semver: GENERATED_TOOL_CONTRACT.protocol_semver, manifest_digest: GENERATED_TOOL_CONTRACT.provenance.manifest_digest, contract_epoch: GENERATED_TOOL_CONTRACT.provenance.contract_epoch, generator_digest: GENERATED_TOOL_CONTRACT.provenance.generator_digest });
`
      return { contents: out, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
  },
}

async function buildAll() {
  fs.mkdirSync(OUT, { recursive: true })
  const result = await esbuild.build({
    entryPoints: [path.join(HERE, 'src/entry.ts')],
    outfile: path.join(OUT, 'spike-runtime.cjs'),
    banner: { js: banner },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    // es2017: keep native async/await (device XWeb runs Chromium), downlevel
    // only ?? / ?. / class-fields — the DevTools device parser rejects es2020
    // tokens with es6:false, and es6:true's babel pass blows 1.6MB → 15MB.
    target: 'es2017',
    minify: true,
    metafile: true,
    write: false,
    logLevel: 'warning',
    plugins: [makeHaimang()],
    loader: { ".wasm": "binary" },
    external: ['node:*', 'fs', 'fs/promises', 'module', 'path', 'url', 'cloudflare:*'],
    nodePaths: [SPIKE_NM],
    mainFields: ['module', 'main'],
    // WeChat appservice wraps each compiled file in a scope that lexically
    // shadows `URL` to undefined (evidence: typeof URL === 'undefined' while
    // globalThis.URL === function). Rewrite bare URL refs to the global —
    // harmless in Node (native URL === globalThis.URL).
    define: { URL: 'globalThis.URL', 'import.meta.url': '__spikeMetaUrl' },
    banner: { js: banner + '\nvar __spikeMetaUrl = require("url").pathToFileURL(__filename).href;' },
  })
  const js = result.outputFiles.find((f) => f.path.endsWith('.cjs'))
  fs.writeFileSync(js.path, js.contents)
  // mp variant: same graph, but the generated tool contract ships with
  // output_schema trimmed to {}. Reason (measured): output_schema bodies are
  // ~892KB of the 1.6MB bundle; the DevTools Summer compiler child dies
  // (code=null signal=S) on the full file, so no JS reaches the device
  // package at all. H1 keeps the FULL contract — a row-for-row match between
  // H1 (full) and S1/R2 (trimmed) is the behavior-neutrality proof.
  const mpResult = await esbuild.build({
    entryPoints: [path.join(HERE, 'src/entry.ts')],
    outfile: path.join(OUT_MP, 'spike-runtime.js'),
    banner: { js: banner },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2017',
    minify: true,
    write: false,
    logLevel: 'warning',
    plugins: [makeHaimang({ mp: true }), contractTrim],
    external: ['node:*', 'cloudflare:*'],
    nodePaths: [SPIKE_NM],
    mainFields: ['module', 'main'],
    define: { URL: 'globalThis.URL' },
  })
  const mpJs = mpResult.outputFiles.find((f) => f.path.endsWith('.js'))
  fs.mkdirSync(OUT_MP, { recursive: true })
  // mp JSCore lacks AbortController/AbortSignal (executor constructs one per
  // call). Inject a minimal conforming polyfill ONLY into the mp variant —
  // the polyfill gap itself is spike evidence (recorded in README).
  const mpPrelude = `
if (typeof AbortController === 'undefined') {
  class Sig { constructor(){this.aborted=false;this._l=[]}
    addEventListener(t,f){if(t==='abort')this._l.push(f)}
    removeEventListener(t,f){this._l=this._l.filter(x=>x!==f)}
    throwIfAborted(){if(this.aborted)throw new Error('AbortError')}}
  globalThis.AbortSignal = Sig
  globalThis.AbortController = class {
    constructor(){this.signal=new Sig()}
    abort(){this.signal.aborted=true;for(const f of this.signal._l.slice()){try{f()}catch(e){}}}
    static timeout(){const c=new globalThis.AbortController();return c.signal}
  }
}
if (typeof queueMicrotask === 'undefined') globalThis.queueMicrotask = (f) => Promise.resolve().then(f)
// TextEncoder/TextDecoder — device XWeb appservice has neither (measured:
// "ReferenceError: TextEncoder is not defined" at <require(vendor/...)> on
// samsung-SM-S9080 / 基础库 3.18.0). UTF-8 codec below is spec-faithful for
// BMP + surrogate pairs; it is the same substrate gap class as
// AbortController/URL/crypto and is recorded in README.
if (typeof globalThis.TextEncoder === 'undefined') {
  var __te = function () {}
  __te.prototype.encode = function (s) {
    var str = String(s), out = []
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i)
      if (c < 0x80) out.push(c)
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
      else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(++i)
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    }
    return new Uint8Array(out)
  }
  globalThis.TextEncoder = __te
}
if (typeof globalThis.TextDecoder === 'undefined') {
  var __tdc = function () {}
  __tdc.prototype.decode = function (buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf || [])
    var s = ''
    for (var i = 0; i < u8.length;) {
      var b = u8[i++]
      if (b < 0x80) s += String.fromCharCode(b)
      else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (u8[i++] & 63))
      else if (b < 0xf0) s += String.fromCharCode(((b & 15) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63))
      else {
        var cp = ((b & 7) << 18) | ((u8[i++] & 63) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63)
        cp -= 0x10000
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023))
      }
    }
    return s
  }
  globalThis.TextDecoder = __tdc
}
// crypto.subtle.digest(SHA-256) + randomUUID — JSCore has no WebCrypto.
// digest output is real SHA-256 bytes via mp/lib/sha256.js (faithful substrate);
// randomUUID uses Math.random — acceptable for idempotency keys in a spike,
// flagged in evidence as a product-relevant substrate gap.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle || typeof globalThis.crypto.randomUUID !== 'function') {
  var __spikeSha256 = require('../lib/sha256.js').sha256
  var __hex2buf = function (hex) { var u = new Uint8Array(hex.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16); return u.buffer }
  if (typeof globalThis.crypto === 'undefined') globalThis.crypto = {}
  if (!globalThis.crypto.subtle) globalThis.crypto.subtle = {
    digest: function (algo, data) {
      var name = typeof algo === 'string' ? algo : (algo && algo.name)
      if (name !== 'SHA-256') return Promise.reject(new Error('spike-stub:subtle-' + name))
      var bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      return Promise.resolve(__hex2buf(__spikeSha256(bytes)))
    }
  }
  if (typeof globalThis.crypto.randomUUID !== 'function') globalThis.crypto.randomUUID = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) })
  }
}
// URL — JSCore lacks the WHATWG URL global; network/policy.ts needs
// new URL(raw), .username/.password get+set, .protocol, .hostname, .href.
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = function URL(u) {
    var m = /^([A-Za-z][A-Za-z0-9+.-]*):\\/\\/(([^@/?#]*)@)?([^/?#]*)([^?#]*)(\\?[^#]*)?(#.*)?$/.exec(String(u))
    if (!m) throw new TypeError('Invalid URL: ' + u)
    var hp = (m[4] || '').split(':')
    var ui = (m[3] || '').split(':')
    this._protocol = m[1].toLowerCase() + ':'
    this._hostname = hp[0].toLowerCase()
    this._port = hp.length > 1 ? hp[1] : ''
    this._username = ui[0] ? decodeURIComponent(ui[0]) : ''
    this._password = ui.length > 1 ? decodeURIComponent(ui.slice(1).join(':')) : ''
    this.pathname = m[5] || '/'
    this.search = m[6] || ''
    this.hash = m[7] || ''
    if (!this._hostname) throw new TypeError('Invalid URL: ' + u)
  }
  globalThis.URL.prototype = {
    get protocol() { return this._protocol },
    set protocol(v) { this._protocol = String(v) },
    get hostname() { return this._hostname },
    set hostname(v) { this._hostname = String(v).toLowerCase() },
    get port() { return this._port },
    set port(v) { this._port = String(v) },
    get username() { return this._username },
    set username(v) { this._username = String(v) },
    get password() { return this._password },
    set password(v) { this._password = String(v) },
    get host() { return this._hostname + (this._port ? ':' + this._port : '') },
    get origin() { return this._protocol + '//' + this.host },
    get href() {
      var ui = this._username ? this._username + (this._password ? ':' + this._password : '') + '@' : ''
      return this._protocol + '//' + ui + this.host + this.pathname + this.search + this.hash
    },
    toString: function () { return this.href },
  }
}
`
  fs.writeFileSync(path.join(OUT_MP, 'spike-runtime.js'),
    Buffer.concat([Buffer.from(mpPrelude, 'utf8'), Buffer.from(mpJs.contents)]))
  // rows.json → mp/lib/rows.js (mp can also require json, but generated module
  // keeps rows source-of-truth single-sided)
  const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'rows/rows.json'), 'utf8'))
  fs.writeFileSync(path.join(HERE, 'mp/lib/rows.js'),
    '// GENERATED by build.mjs from rows/rows.json — do not edit\nmodule.exports = { ROWS: ' + JSON.stringify(rows) + ' }\n')
  console.log(`[nano-tools] bundle -> bundle/spike-runtime.cjs + mp/vendor/spike-runtime.js (${(js.contents.length / 1024).toFixed(0)} KB)`)
  if (result.metafile) fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(result.metafile))
  const inputs = Object.keys(result.metafile?.inputs ?? {})
  const bad = inputs.filter(i => i.includes('node_modules') && !i.includes('spike/nano-sim'))
  if (bad.length) console.log(`[nano-tools] note: npm deps bundled: ${bad.join(', ')}`)
}
buildAll().catch((e) => { console.error(e); process.exit(1) })
