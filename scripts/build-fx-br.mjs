// fx wasm brotli 压缩：subpkg/fx/*.wasm → *.wasm.br
// 背景：WXWebAssembly.instantiate 原生支持 .wasm.br（基础库 2.14.0+，
// 官方对"wasm 超包限"的答案）；4.1MB wasm brotli q11 ≈ 1.0MB，fx 分包 <2M。
// 原始 .wasm 留在工作区供再生成（packOptions 排除，不进代码包）。
// 用法：node scripts/build-fx-br.mjs
import { brotliCompressSync, constants } from 'node:zlib'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'subpkg/fx')
const wasms = readdirSync(dir).filter((f) => f.endsWith('.wasm'))

if (wasms.length === 0) {
  console.log('[build-fx-br] subpkg/fx 无 .wasm 产物——fx 为 secondary 车道，跳过（zig build + wasm-opt 再生成后可重跑）')
  process.exit(0)
}

let failed = false
for (const name of wasms) {
  const src = readFileSync(join(dir, name))
  const out = brotliCompressSync(src, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
  writeFileSync(join(dir, `${name}.br`), out)
  const pct = ((out.length / src.length) * 100).toFixed(1)
  console.log(`[build-fx-br] ${name} ${src.length} → ${name}.br ${out.length} (${pct}%)`)
  // 硬闸：单分包 2M——.br + 分包内其他文件合计不得超限
  const siblings = readdirSync(dir).filter((f) => f !== name && !f.endsWith('.wasm')).reduce((s, f) => s + statSync(join(dir, f)).size, 0)
  if (out.length + siblings > 2 * 1024 * 1024) {
    console.error(`[build-fx-br] FAIL subpkg/fx 分包 ${(out.length + siblings) / 1048576}MB 超 2M 限额`)
    failed = true
  }
}
if (failed) process.exit(1)
console.log('[build-fx-br] done')
