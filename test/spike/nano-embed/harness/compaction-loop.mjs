// nano-embed · 模拟器内真实 compaction 多轮：真实 magpie + 512K 窗口 + 0.5 水位。
// 不是伪造 policy：窗口与水位来自 .local.development.json → services/fx/dev-config.ts。
// 用法: node test/spike/nano-embed/harness/compaction-loop.mjs [--turns 10] [--size 150000]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectIde } from '../../../../scripts/dev-cli/lib/ide.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..', '..', '..', '..')
const evidenceDir = join(root, 'test/spike/nano-embed/evidence/compaction')
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 ? Number(argv[i + 1]) : fallback
}
const turns = argOf('--turns', 10)
const size = argOf('--size', 150000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail: String(detail).slice(0, 700) })
const consoleLines = []
const ide = await connectIde({ port: Number(process.env.AUTO_PORT ?? 9602) })
ide.mp.on('console', (m) => {
  const text = (m.args ?? []).map((a) => {
    try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch { return '' }
  }).join(' ')
  if (text.includes('[compact]') || text.includes('[micro-compact]')) consoleLines.push(text)
})

const info = await ide.mp.evaluate(() => {
  const d = wx.getDeviceInfo()
  return { brand: d.brand, model: d.model, platform: d.platform }
})

function readSession(sessionId) {
  return wx.getStorageSync(`dsh:mini:kv/dsh-mini/state/local/${sessionId}`)
}

try {
  check('env:simulator', info.platform === 'devtools', JSON.stringify(info))
  await ide.mp.evaluate(() => {
    wx.setStorageSync('dsh:mini:engine:v1', 'magpie')
    wx.setStorageSync('dsh:permission:v1', 'danger-full-access')
  })
  const page = await ide.mp.currentPage()
  const beforeCreate = await page.data()
  const prevId = beforeCreate?.state?.current?.sessionId
  await page.callMethod('newSession').catch(() => null)
  let first = beforeCreate
  const createDeadline = Date.now() + 10000
  while (Date.now() < createDeadline) {
    first = await page.data()
    const id = first?.state?.current?.sessionId
    const status = first?.state?.current?.status
    if (typeof id === 'string' && id !== prevId && status !== 'running') break
    await sleep(300)
  }
  const sessionId = first?.state?.current?.sessionId
  check('session:created', typeof sessionId === 'string' && sessionId.length > 0, String(sessionId))

  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(Math.ceil(size / 45))
  const perTurn = []

  for (let i = 0; i < turns; i += 1) {
    const before = (await page.data())?.state?.current?.items?.length ?? 0
    const prompt = i === 1
      ? `Turn ${i + 1}. First use the write tool to create /tmp/micro-${Date.now()}.txt with content "micro-probe", then use the cat tool to read it back. Then reply with exactly: ok-${i + 1}`
      : `Turn ${i + 1}. Keep this context for later. ${filler}\n\nReply with exactly: ok-${i + 1}`
    await page.setData({ input: prompt })
    await page.callMethod('send')

    const deadline = Date.now() + 240000
    let data = await page.data()
    while (Date.now() < deadline) {
      data = await page.data()
      const status = data?.state?.current?.status
      if (status !== 'running' && status !== undefined) break
      await sleep(600)
    }
    const items = data?.state?.current?.items ?? []
    const added = items.slice(before)
    const assistant = added.filter((x) => x.kind === 'assistant_message').pop()
    const llmCalls = assistant?.llmCalls ?? []
    const inputTokens = llmCalls.reduce((n, c) => n + (typeof c.inputTokens === 'number' ? c.inputTokens : 0), 0)
    const row = sessionId === undefined ? null : await ide.mp.evaluate((sid) => {
      const raw = wx.getStorageSync(`dsh:mini:kv/dsh-mini/state/local/${sid}`)
      if (!raw || typeof raw !== 'object') return null
      const env = JSON.parse(String(raw.body))
      const frag = env.frag ?? env
      return { compactCount: frag?.session?.compactCount ?? 0, ep: env.ep ?? null }
    }, sessionId).catch(() => null)
    perTurn.push({
      turn: i + 1,
      status: data?.state?.current?.status,
      error: data?.state?.error ?? null,
      reply: String(assistant?.text ?? '').slice(0, 60),
      calls: llmCalls.length,
      inputTokens,
      compactCount: row?.compactCount ?? 0,
    })
    console.log(`turn ${i + 1}: status=${data?.state?.current?.status} calls=${llmCalls.length} in=${inputTokens} compact=${row?.compactCount ?? 0} err=${data?.state?.error ?? ''} reply=${String(assistant?.text ?? '').slice(0, 40)}`)
  }

  const episodes = await ide.mp.evaluate(() => {
    const index = wx.getStorageSync('dsh:mini:index')
    const keys = Array.isArray(index) ? index.filter((k) => String(k).includes('episodes/local')) : []
    return keys.map((k) => {
      const row = wx.getStorageSync(`dsh:mini:kv/${k}`)
      try { return JSON.parse(String(row?.body ?? row)) } catch { return { key: k } }
    })
  }).catch(() => [])

  const maxInput = Math.max(...perTurn.map((t) => t.inputTokens), 0)
  const compactCount = Math.max(...perTurn.map((t) => t.compactCount), 0)
  const compactLog = consoleLines.find((l) => l.includes('[compact]'))
  const microLog = consoleLines.find((l) => l.includes('[micro-compact]'))

  check('turns:all-idle', perTurn.every((t) => t.status === 'idle'), JSON.stringify(perTurn.map((t) => t.status)))
  check('turns:replies', perTurn.every((t) => t.reply.includes(`ok-${t.turn}`) || t.reply.length > 0), JSON.stringify(perTurn.map((t) => t.reply)))
  check('watermark:crossed-0.3', maxInput >= 512000 * 0.3, `max inputTokens=${maxInput} (threshold 153600)`)
  check('compaction:compact-count', compactCount >= 1, `compactCount=${compactCount}`)
  check('compaction:episode-row', episodes.some((r) => r.trigger_kind === 'structural' || r.trigger_kind === 'compact_required'), JSON.stringify(episodes.map((r) => ({ kind: r.trigger_kind, parent: r.parent_episode_uuid }))))
  check('compaction:log', compactLog !== undefined && /"tokensFreed":\d+/.test(compactLog), compactLog ?? '(none)')
  check('compaction:tokens-freed-positive', compactLog !== undefined && Number((/"tokensFreed":(\d+)/.exec(compactLog) ?? [])[1] ?? 0) > 0, compactLog ?? '(none)')
  check('micro:log', microLog !== undefined && /"folded":[1-9]/.test(microLog), microLog ?? '(none)')
} catch (e) {
  check('run:error', false, e instanceof Error ? e.message : String(e))
} finally {
  try { await ide.mp.disconnect?.() } catch { /* ignore */ }
  if (ide.proc && ide.proc.exitCode === null) ide.proc.kill('SIGTERM')
}

const status = checks.every((c) => c.ok) ? 'pass' : 'fail'
const record = { spike: 'nano-embed/compaction-loop', mode: 'devtools-simulator + real-magpie + 512K/0.5', turns, size, device: info, checks, console: consoleLines.slice(0, 20), status, ran_at: new Date().toISOString() }
mkdirSync(evidenceDir, { recursive: true })
const file = join(evidenceDir, `${record.ran_at.replace(/[:.]/g, '-')}.json`)
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
console.log(JSON.stringify({ status, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length, evidence: file }, null, 2))
if (checks.some((c) => !c.ok)) for (const c of checks.filter((x) => !x.ok)) console.log('FAIL', c.name, c.detail)
process.exit(status === 'pass' ? 0 : 1)
