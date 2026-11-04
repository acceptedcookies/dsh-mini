#!/usr/bin/env node
// MN01 正式 kernel 构建管线（T-O-6）：单一构建 → 双出口同字节。
//   mp 出口    subpkg/kernel/kernel.js            （小程序分包懒载）
//   sweeper 出口 cloud/functions/sweeper/vendor/kernel.cjs
// 硬闸：kernelPin == context/nano-agent HEAD 且工作树干净，否则非零退出。
// banner：__zod_globalConfig={jitless:true}（T-O-B7，mp JSC 必需）+ kernelPin 头注。
// entry 形状固化（T2）：export * as kernel + export * as executor 双命名空间。
// --upgrade <commit>：升级通道（checkout → 更新 kernelPin → 重建 → 提示跑 L1）。
//   默认干跑只打印计划，加 --apply 才执行。
// --host：额外编译 services/nano-mini-host → vendor/host.cjs（P3 sweeper 复用）。
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const NANO = path.join(REPO, 'context/nano-agent')
const PKGS = path.join(NANO, 'packages')
const WORKERS = path.join(NANO, 'workers')
const SPIKE_NM = path.join(REPO, 'test/spike/node_modules')
const OUT_MP = path.join(REPO, 'subpkg/kernel/kernel.js')
const OUT_SWEEPER = path.join(REPO, 'cloud/functions/sweeper/vendor/kernel.cjs')
const OUT_HOST = path.join(REPO, 'cloud/functions/sweeper/vendor/host.cjs')
const ENTRY = path.join(REPO, 'subpkg/kernel/.entry.ts')
// esbuild 作为 spike 级 dev-dep 存于 test/spike/node_modules
const spikeRequire = createRequire(path.join(REPO, 'test/spike/package.json'))
const esbuild = spikeRequire('esbuild')

const args = process.argv.slice(2)
const upgradeIdx = args.indexOf('--upgrade')
const UPGRADE = upgradeIdx >= 0 ? args[upgradeIdx + 1] : undefined
const APPLY = args.includes('--apply')
const WITH_HOST = args.includes('--host')
const CHECK_ONLY = args.includes('--check')

const fail = (msg) => { console.error(`[build-kernel] ${msg}`); process.exit(1) }
const log = (msg) => console.log(`[build-kernel] ${msg}`)
const gitNano = (gargs) =>
  execFileSync('git', ['-C', NANO, ...gargs], { encoding: 'utf8' }).trim()

// ── kernelPin 读取与校验 ──────────────────────────────────────────────
const pkgPath = path.join(REPO, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const pin = pkg.kernelPin
if (typeof pin !== 'string' || pin.length < 7) {
  if (UPGRADE === undefined) fail('package.json kernelPin 缺失 —— 先登记 pin 或用 --upgrade')
}
const head = gitNano(['rev-parse', 'HEAD'])
const dirty = gitNano(['status', '--porcelain']).length > 0

if (UPGRADE !== undefined) {
  // 升级通道：干跑打印计划；--apply 才执行 checkout + pin 更新
  const plan = [
    `checkout context/nano-agent → ${UPGRADE}`,
    `package.json kernelPin: ${pin} → ${UPGRADE}`,
    `rebuild 双出口产物`,
    `随后跑 L1: node scripts/mn01-harness.mjs`,
  ]
  if (!APPLY) {
    log(`--upgrade 干跑（加 --apply 执行）：\n  ${plan.join('\n  ')}`)
    process.exit(0)
  }
  try { gitNano(['cat-file', '-e', `${UPGRADE}^{commit}`]) } catch { fail(`commit ${UPGRADE} 不存在`) }
  gitNano(['checkout', UPGRADE])
  pkg.kernelPin = UPGRADE
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  log(`已切 ${UPGRADE} 并更新 kernelPin`)
}
if (pin !== undefined && pin !== head) {
  fail(`kernelPin ${pin} != HEAD ${head} —— 参考系漂移，用 --upgrade 显式升级`)
}
if (dirty) fail('context/nano-agent 工作树不干净 —— pin 校验拒绝构建')
if (CHECK_ONLY) { log(`pin OK: ${head}`); process.exit(0) }

// ── @haimang/* alias → context/nano-agent TS 源（移植 spike lib/bundle.mjs）──
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
const haimang = {
  name: 'haimang-workspace',
  setup(build) {
    build.onResolve({ filter: /^@(haimang|nano-agent)\// }, (a) => {
      const [ns, name, ...rest] = a.path.split('/')
      const found = resolveSpec(`${ns}/${name}`, rest.join('/'))
      return found
        ? { path: found }
        : { errors: [{ text: `unresolved workspace spec ${a.path}` }] }
    })
  },
}

// T2 entry 形状固化（T-O-1）：双命名空间，勿改平铺（smoke 断言依此）
fs.mkdirSync(path.dirname(ENTRY), { recursive: true })
fs.writeFileSync(ENTRY, [
  `// GENERATED by scripts/build-kernel.mjs —— T2 entry 形状固化`,
  `export * as kernel from '@haimang/agent-runtime-kernel'`,
  `export * as executor from '@haimang/agent-provider-executor'`,
].join('\n'))

const banner = [
  `/* kernelPin=${head} built=${new Date().toISOString()} */`,
  `globalThis.__zod_globalConfig={jitless:true};`,
].join('\n')

async function buildOne(entryPoint, outfile, extraBanner = '') {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    banner: { js: banner + extraBanner },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2020',
    minify: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins: [haimang],
    external: ['node:*', 'cloudflare:*'],
    nodePaths: [SPIKE_NM],
    mainFields: ['module', 'main'],
  })
  const out = result.outputFiles[0]
  fs.mkdirSync(path.dirname(outfile), { recursive: true })
  fs.writeFileSync(outfile, out.contents)
  return out.contents
}

const contents = await buildOne(ENTRY, OUT_MP)
fs.mkdirSync(path.dirname(OUT_SWEEPER), { recursive: true })
fs.writeFileSync(OUT_SWEEPER, contents) // 同字节双出口
const digest = crypto.createHash('sha256').update(contents).digest('hex')
log(`kernel pin=${head.slice(0, 8)} bytes=${contents.length} sha256=${digest.slice(0, 16)}`)
log(`  → ${path.relative(REPO, OUT_MP)}`)
log(`  → ${path.relative(REPO, OUT_SWEEPER)}`)

if (WITH_HOST) {
  const hostSrc = path.join(REPO, 'services/nano-mini-host/pump.ts')
  if (!fs.existsSync(hostSrc)) fail('--host 需要 services/nano-mini-host/pump.ts（P2 建成后可用）')
  const hostContents = await buildOne(hostSrc, OUT_HOST, '')
  log(`  → ${path.relative(REPO, OUT_HOST)} bytes=${hostContents.length}`)
}
fs.rmSync(ENTRY, { force: true })
log('done')
