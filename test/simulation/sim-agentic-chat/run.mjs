import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, currentText } from '../lib/app.mjs'
import { capture } from '../lib/screenshots.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { startScriptedLlm } from '../lib/mock-upstream.mjs'

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
    await app.call('setData', { input: fixture.cancel })
    const running = await app.data()
    if (running.state?.current?.status === 'running') await app.call('stop')
    const data = await app.data()
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
  live: async () => openEvidence(dir, 'live').finish({
    sim: 'sim-agentic-chat', status: 'live-blocked', endpoint: 'configured-magpie', shots: [],
    note: '本机没有独立的真 magpie 路由；页面错误态不记 live-pass',
  }),
})
