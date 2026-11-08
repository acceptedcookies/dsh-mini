#!/usr/bin/env node
// spike / nano-tools — S1 (simulator) / R2 (real device) driver.
//   node run-mp.mjs --s1            automator on DevTools simulator
//   node run-mp.mjs --r2            automator + mp.remote(true) → Samsung device
//   AUTO_PORT=9603 node run-mp.mjs --s1   reuse an existing automator ws
//
// Flow: connectIde({project:mp}) → [r2: attachDevice] → reLaunch probe →
// capture mp console until '[nano-tools] DONE|FATAL' → pull evidence global →
// write evidence/{s1|r2}-<ts>.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP_DIR = path.join(HERE, 'mp')
const REPO = path.resolve(HERE, '../../..')
const { connectIde } = await import(path.join(REPO, 'scripts/dev-cli/lib/ide.mjs'))
// R2 真机必须走仓库 attachDevice（桥存活守卫 + 超时释放）——
// 契约：禁止临时脚本直发 mp.remote()，重复 remote 会打坏 IDE 状态致白屏。
const { attachDevice } = await import(path.join(REPO, 'test/simulation/lib/devtools.mjs'))

const args = new Set(process.argv.slice(2))
const MODE = args.has('--r2') ? 'r2' : 's1'
const PORT = Number(process.env.AUTO_PORT ?? 9603)
const DONE_TIMEOUT = Number(process.env.SPIKE_TIMEOUT_MS ?? 240_000)

// --listen: LAN evidence receiver for device runs. The automator channel never
// reaches true remote-debug mode in this IDE (phone UA carries no
// remotedebugappservice token → appservice code 403 → page JS never arrives),
// so the probe page POSTs its evidence to the Mac instead. Phone→Mac LAN
// reachability is measured (GET / on the IDE device port returns 403, i.e.
// routed, not refused).
if (args.has('--listen')) {
  const http = await import('node:http')
  const port = Number(process.env.SPIKE_LISTEN_PORT ?? 8899)
  http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      if (req.url !== '/evidence' || !body) return
      let payload = null
      try { payload = JSON.parse(body) } catch (e) { console.log('[listen] bad json'); return }
      const ev = payload.evidence ?? payload
      ev.env = 'R2'
      fs.mkdirSync(path.join(HERE, 'evidence'), { recursive: true })
      const f = path.join(HERE, `evidence/r2-${Date.now()}.json`)
      fs.writeFileSync(f, JSON.stringify({ evidence: ev, console: [], via: 'lan-post' }, null, 2))
      console.log(`[listen] evidence -> ${path.relative(process.cwd(), f)}`)
      console.log(`[listen] summary: ${JSON.stringify(ev.summary)}`)
    })
  }).listen(port, '0.0.0.0', () => console.log(`[listen] http://0.0.0.0:${port}/evidence`))
}

const log = (m) => console.log(`[run-${MODE}] ${m}`)

async function main() {
  const ide = await connectIde({ project: MP_DIR, port: PORT })
  const mp = ide.mp
  log(`connected via ${ide.via} port=${ide.port}`)

  const dev = MODE === 'r2' ? await attachDevice(mp) : null
  if (dev) log(`device: ${dev.brand} ${dev.model} ${dev.system}`)

  // wait for the first compile/page-meta before touching pages (fresh
  // project windows race the automator Connection layer otherwise)
  const readyDeadline = Date.now() + 120_000
  let ready = false
  while (Date.now() < readyDeadline && !ready) {
    try {
      const p = await mp.currentPage()
      if (p?.path) ready = true
    } catch { await new Promise(r => setTimeout(r, 2000)) }
  }
  log(`page meta ready: ${ready}`)

  const lines = []
  const doneP = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), DONE_TIMEOUT)
    mp.on('console', (m) => {
      const line = (m.args ?? []).map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      lines.push(`[${m.type ?? 'log'}] ${line}`)
      if (/\[nano-tools\] (DONE|FATAL)/.test(line)) { clearTimeout(timer); resolve('done') }
    })
  })

  // the probe's double-onLoad guard persists across reLaunch within the same
  // app instance — clear it first or this run is silently skipped and we pull
  // stale evidence from the previous run.
  await mp.evaluate(() => { getApp().globalData = getApp().globalData || {}; getApp().globalData.nanoToolsRunning = false }).catch(() => {})

  // PITFALL-15: reLaunch/navigateTo on a REAL-DEVICE remote-debug session
  // kills it (Device disconnected InternalError). Device lane therefore only
  // operates the current page: the probe is the entry page, so we trigger its
  // runAll() in place. Simulator lane keeps reLaunch.
  if (MODE === 'r2') {
    const started = await mp.evaluate(() => {
      const p = getCurrentPages(); const pg = p[p.length - 1]
      if (!pg || typeof pg.runAll !== 'function') return 'no-runAll:' + (pg && pg.route)
      const app = getApp(); app.globalData = app.globalData || {}
      app.globalData.nanoToolsEvidence = null
      app.globalData.nanoToolsRunning = true
      pg.runAll()
      return 'started'
    }).catch(e => 'eval-err: ' + String(e?.message ?? e).slice(0, 160))
    log(`probe start: ${started}`)
  } else {
    for (let i = 0; i < 4; i++) {
      try { await mp.reLaunch('/pages/probe/probe'); break } catch (e) {
        log(`reLaunch attempt ${i + 1} failed: ${String(e?.message ?? e).slice(0, 120)}`)
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }
  log('probe launched, waiting for DONE…')
  const status = await doneP
  log(`console status: ${status} (${lines.length} lines)`)

  // globalData may momentarily be null (onLoad reset on a double launch, or
  // evaluate raced the DONE line) — retry briefly, never throw the console
  // capture away on a null pull.
  let evidence = null
  for (let i = 0; i < 6 && !evidence; i++) {
    evidence = await mp.evaluate(() => getApp().globalData.nanoToolsEvidence).catch(() => null)
    if (!evidence) await new Promise(r => setTimeout(r, 1500))
  }
  evidence = evidence ?? { pullFailed: true }
  evidence.env = MODE.toUpperCase()
  evidence.device = dev ?? 'devtools-simulator'
  evidence.consoleStatus = status

  fs.mkdirSync(path.join(HERE, 'evidence'), { recursive: true })
  const f = path.join(HERE, `evidence/${MODE}-${Date.now()}.json`)
  fs.writeFileSync(f, JSON.stringify({ evidence, console: lines }, null, 2))
  log(`evidence -> ${path.relative(process.cwd(), f)}`)
  if (evidence.summary) log(`summary: ${JSON.stringify(evidence.summary)}`)
  else log(`NO SUMMARY — check console in evidence file`)

  try { await mp.disconnect?.() } catch { }
  if (ide.proc && ide.proc.exitCode === null) ide.proc.kill('SIGTERM')
}
if (!args.has('--listen')) main().catch((e) => { console.error(e); process.exit(1) })
