#!/usr/bin/env node
// nano-embed spike driver: 跑各档打包 + API 扫描 + 证据落盘。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleTier, scanSurface, PKGS, WORKERS, OUT } from '../lib/bundle.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EVID = path.join(HERE, '../evidence')
fs.mkdirSync(EVID, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

const only = process.argv[2] // e.g. em-h1

// 合成入口：T2 = kernel + provider-executor 同时引入
const t2entry = path.join(OUT, 'entry-t2.ts')
fs.writeFileSync(t2entry, [
  `export * as kernel from '@haimang/agent-runtime-kernel'`,
  `export * as executor from '@haimang/agent-provider-executor'`,
].join('\n'))

// T3 = T2 + agent-core 便携子集（kernel/llm 两个 index）
const t3entry = path.join(OUT, 'entry-t3.ts')
fs.writeFileSync(t3entry, [
  `export * as kernel from '@haimang/agent-runtime-kernel'`,
  `export * as executor from '@haimang/agent-provider-executor'`,
  `export * as hostKernel from '${path.join(WORKERS, 'agent-core/src/kernel/index.ts')}'`,
  `export * as hostLlm from '${path.join(WORKERS, 'agent-core/src/llm/index.ts')}'`,
].join('\n'))

const TIERS = [
  { row: 'em-h1', name: 't1-kernel', entries: [path.join(PKGS, 'agent-runtime-kernel/src/index.ts')] },
  { row: 'em-h2', name: 't2-kernel-exec', entries: [t2entry] },
  { row: 'em-h3', name: 't3-host-lite', entries: [t3entry] },
  { row: 'em-h4', name: 't4-whole-agent-core', entries: [path.join(WORKERS, 'agent-core/src/index.ts')] },
]

const rows = {}
for (const tier of TIERS) {
  if (only && tier.row !== only) continue
  const res = await bundleTier(tier)
  const rec = { row: tier.row, name: tier.name, at: new Date().toISOString(), ...res }
  if (res.ok) {
    rec.surface = scanSurface(path.join(OUT, `${tier.name}.cjs`))
    rec.bytes_gzip_ish = undefined // gzip 由 S2 行统一算
    // top 15 大头文件
    rec.top_files = res.inputs.slice(0, 15)
    delete rec.inputs
  }
  const f = path.join(EVID, `${tier.row}-${Date.now()}.json`)
  fs.writeFileSync(f, JSON.stringify(rec, null, 2))
  rows[tier.row] = rec
  console.log(`\n=== ${tier.row} ${tier.name} ===`)
  console.log(JSON.stringify({ ok: rec.ok, bytes_raw: rec.bytes_raw, files: rec.files, errors: rec.errors?.slice(0, 8), surface: rec.surface }, null, 1))
}
fs.writeFileSync(path.join(EVID, `summary-${Date.now()}.json`), JSON.stringify(rows, null, 2))
