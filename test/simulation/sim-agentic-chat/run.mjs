import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, currentText } from '../lib/app.mjs'
import { capture } from '../lib/screenshots.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { startScriptedLlm } from '../lib/mock-upstream.mjs'
import { openPhone, shot } from '../lib/phone.mjs'
import { PRODUCTION_BASE } from '../lib/env.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(dir, 'fixtures/script.json'), 'utf8'))

async function journey(mode, llm) {
  const evidence = openEvidence(dir, mode)
  const shots = []
  const app = await openApp()
  try {
    shots.push(await bootWorkspace(app, evidence))
    await app.call('setData', { input: fixture.prompt })
    shots.push(await capture(app, evidence, '02-typed', { route: 'pages/workspace/workspace', includes: [fixture.prompt] }))
    await app.call('send')
    const deadline = Date.now() + 20000
    let data = await app.data()
    while (Date.now() < deadline) {
      data = await app.data()
      const status = data.state?.current?.status
      const text = currentText(data)
      if (status === 'error' || text.includes(fixture.reply) || text.includes('停止') || text.includes('已请求停止')) break
      if (status === 'running') break
      await new Promise((r) => setTimeout(r, 300))
    }
    if (data.state?.current?.status === 'running') await app.call('stop')
    data = await app.data()
    shots.push(await capture(app, evidence, '03-settled', { route: 'pages/workspace/workspace' }))
    const text = currentText(data)
    evidence.check('chat:user-visible', text.includes(fixture.prompt), text.slice(0, 180))
    evidence.check('chat:not-running', data.state?.current?.status !== 'running', data.state?.current?.status ?? 'none')
    const outcome = typeof data.state?.error === 'string'
      || text.includes(fixture.reply)
      || text.includes('停止')
      || text.includes('已请求停止')
    evidence.check('chat:reply-stop-or-error', outcome, `status=${data.state?.current?.status ?? 'none'} ${text.slice(0, 180)}`)
    return evidence.finish({
      sim: 'sim-agentic-chat', endpoint: llm?.base ?? 'app-route', shots,
      control_mock: mode === 'mock' ? ['llm-upstream'] : [],
      note: llm ? `requests ${llm.seen().length}` : 'live uses configured magpie route',
    })
  } finally {
    await app.close()
  }
}

const mode = modeOf()
await runModes({
  sim: 'sim-agentic-chat',
  mode,
  mock: async () => {
    const llm = await startScriptedLlm({ text: fixture.reply })
    try { return await journey('mock', llm) } finally { await llm.close() }
  },
  live: async () => {
    const evidence = openEvidence(dir, 'live')
    const app = await openPhone()
    try {
      const shots = [await shot(app, evidence, '01-phone')]
      const before = ((await app.data())?.state?.current?.items ?? []).length
      await app.setData({ input: fixture.prompt })
      shots.push(await shot(app, evidence, '02-typed'))
      await app.eval('() => { const page = getCurrentPages().slice(-1)[0]; const bar = page.selectComponent("#composer"); bar.onSend() }')
      const items = (await app.data())?.state?.current?.items ?? []
      const added = items.slice(before)
      evidence.check('phone:new-turn', added.some((item) => String(item.text ?? '').includes(fixture.prompt)), JSON.stringify(added).slice(0, 180))
      shots.push(await shot(app, evidence, '03-done'))
      return evidence.finish({ sim: 'sim-agentic-chat', endpoint: PRODUCTION_BASE, shots, device: app.device, note: '真机页面发送，走手机自己的网络' })
    } finally { await app.close() }
  },
})
