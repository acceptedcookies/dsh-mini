// nano-embed · 真机前模拟器 GSTH 类循环：模拟器 UI + 真实 magpie LLM + 真实 kernel。
// 不是 sim（不改 test/simulation 的口径），是 spike：只产事实。
// 用法: node test/spike/nano-embed/harness/magpie-loop.mjs [--turns 3] [--tool]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectIde } from '../../../../scripts/dev-cli/lib/ide.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..', '..', '..', '..')
const evidenceDir = join(root, 'test/spike/nano-embed/evidence/magpie-loop')
const args = process.argv.slice(2)
const turnsArg = args.indexOf('--turns')
const turns = turnsArg >= 0 ? Number(args[turnsArg + 1]) : 3
const withTool = args.includes('--tool')

const prompts = [
  'Reply with the single word: alpha',
  'Reply with the single word: beta',
  'Reply with the single word: gamma',
  'Reply with the single word: delta',
]
const toolPath = `/tmp/gsth-${Date.now()}.txt`
if (withTool) prompts[1] = `Use the write tool to create ${toolPath} with content "gsth-ok", then use the cat tool to read ${toolPath}, then reply with exactly the content cat returned.`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitIdle(page, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let data = await page.data()
  while (Date.now() < deadline) {
    data = await page.data()
    const status = data?.state?.current?.status
    if (status !== 'running' && status !== undefined) return data
    await sleep(400)
  }
  return data
}

const ide = await connectIde({ port: Number(process.env.AUTO_PORT ?? 9602) })
const info = await ide.mp.evaluate(() => {
  const d = wx.getDeviceInfo()
  return { brand: d.brand, model: d.model, platform: d.platform }
})
const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail: String(detail).slice(0, 600) })

try {
  if (info.platform !== 'devtools') {
    check('env:simulator', false, JSON.stringify(info))
    throw new Error('magpie-loop 只在 devtools 模拟器跑')
  }
  check('env:simulator', true, JSON.stringify(info))

  await ide.mp.evaluate(() => { wx.setStorageSync('dsh:mini:engine:v1', 'magpie'); wx.setStorageSync('dsh:permission:v1', 'danger-full-access') })
  const page = await ide.mp.currentPage()
  await page.callMethod('newSession').catch(() => null)
  await sleep(700)

  for (let i = 0; i < Math.min(turns, prompts.length); i += 1) {
    const before = (await page.data())?.state?.current?.items?.length ?? 0
    await page.setData({ input: prompts[i] })
    await page.callMethod('send')
    const data = await waitIdle(page)
    const items = data?.state?.current?.items ?? []
    const added = items.slice(before)
    const assistant = added.filter((x) => x.kind === 'assistant_message')
    const last = assistant[assistant.length - 1]
    check(`turn${i + 1}:status`, data?.state?.current?.status === 'idle', data?.state?.current?.status)
    check(`turn${i + 1}:assistant`, assistant.length > 0 && String(last?.text ?? '').length > 0, last?.text ?? '(none)')
    check(`turn${i + 1}:usage`, Array.isArray(last?.llmCalls) && last.llmCalls.length > 0 && typeof last.llmCalls[0].inputTokens === 'number' && typeof last.llmCalls[0].outputTokens === 'number', JSON.stringify(last?.llmCalls ?? null))
    if (withTool && i === 1) {
      const calls = added.filter((x) => x.kind === 'tool_call')
      const results = added.filter((x) => x.kind === 'tool_result')
      const names = calls.map((x) => x.tool)
      check('turn2:tool-calls', names.includes('write') && names.includes('cat'), JSON.stringify(names))
      check('turn2:tool-results', results.length >= 2 && results.every((x) => x.status !== 'error'), JSON.stringify(results.map((x) => ({ tool: x.tool, status: x.status }))))
      const catResult = results.find((x) => x.tool === 'cat')
      const catText = String(catResult?.summary ?? catResult?.text ?? '')
      check('turn2:vfs-roundtrip', catText.includes('gsth-ok'), catText)
      check('turn2:reply', String(last?.text ?? '').includes('gsth-ok'), String(last?.text ?? ''))
    }
  }
} catch (e) {
  check('run:error', false, e instanceof Error ? e.message : String(e))
} finally {
  try { await ide.mp.disconnect?.() } catch { /* ignore */ }
  if (ide.proc && ide.proc.exitCode === null) ide.proc.kill('SIGTERM')
}

const status = checks.every((c) => c.ok) ? 'pass' : 'fail'
const record = {
  spike: 'nano-embed/magpie-loop',
  mode: 'devtools-simulator + real-magpie',
  turns,
  withTool,
  device: info,
  checks,
  status,
  ran_at: new Date().toISOString(),
}
mkdirSync(evidenceDir, { recursive: true })
const file = join(evidenceDir, `${record.ran_at.replace(/[:.]/g, '-')}.json`)
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
console.log(JSON.stringify({ status, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length, evidence: file }, null, 2))
if (checks.some((c) => !c.ok)) for (const c of checks.filter((x) => !x.ok)) console.log('FAIL', c.name, c.detail)
process.exit(status === 'pass' ? 0 : 1)
