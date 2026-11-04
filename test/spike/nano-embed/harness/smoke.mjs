#!/usr/bin/env node
// EM-S1: t1-kernel bundle 在 DevTools appService 内执行实测。
import { createRequire } from 'node:module'
const automator = createRequire(import.meta.url)('miniprogram-automator')
const { spawn } = await import('node:child_process')
const path = await import('node:path')

const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const MP = path.resolve(new URL('..', import.meta.url).pathname, 'mp')

async function connect() {
  if (process.env.AUTO_PORT) return automator.connect({ wsEndpoint: `ws://127.0.0.1:${process.env.AUTO_PORT}` })
  const proc = spawn(CLI, ['auto', '--project', MP, '--auto-port', '9602'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (out += d))
  const deadline = Date.now() + 240000
  let port = null
  while (Date.now() < deadline) {
    const m = /"autoPort":\s*(\d+)/.exec(out)
    if (m) { port = Number(m[1]); break }
    if (proc.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (port == null) throw new Error('cli auto no autoPort:\n' + out.slice(-800))
  let last = null
  while (Date.now() < deadline) {
    try { return await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` }) }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500)) }
  }
  throw last ?? new Error('ws unreachable')
}

const mp = await connect()
console.log('connected')
// probe 页 onLoad 已跑 bundle；等报告落 data（首编译期间协议层可能报错）
let report = null
for (let i = 0; i < 90; i++) {
  try {
    const page = await mp.currentPage()
    report = await page?.data('report').catch(() => null)
    if (report) break
  } catch { /* appService 未就绪 */ }
  await new Promise((r) => setTimeout(r, 1000))
}
console.log(JSON.stringify(report, null, 2))
await mp.disconnect().catch(() => {})
process.exit(report && report.loaded ? 0 : 1)
