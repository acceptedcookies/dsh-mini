import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, currentText, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { devTicket, post, startLiveGateway } from '../lib/gateway.mjs'
import { openPhone, phoneSteps, shot, step } from '../lib/phone.mjs'
import { PRODUCTION_BASE } from '../lib/env.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const prompt = readFileSync(join(dir, 'fixtures/prompt.txt'), 'utf8').trim()

async function conflict(mode, gw) {
  const evidence = openEvidence(dir, mode)
  const app = await openApp()
  try {
    const start = await bootWorkspace(app, evidence)
    const ticket = await devTicket(gw.base, gw.admin, TEST_OID)
    const held = await post(gw.base, '/v1/claim', ticket, { key: 'sim-session', holder: 'shadow', ttlMs: 60000 })
    evidence.check('claim:shadow-holds', held.status === 200, JSON.stringify(held.body))
    const rival = await post(gw.base, '/v1/claim', ticket, { key: 'sim-session', holder: 'app', ttlMs: 60000 })
    evidence.check('claim:app-denied', rival.status === 412 && rival.body?.holder === 'shadow', JSON.stringify(rival.body))
    const sent = await typeAndSend(app, evidence, prompt)
    evidence.check('claim:prompt-visible', currentText(sent.data).includes(prompt), currentText(sent.data).slice(0, 120))
    const released = await post(gw.base, '/v1/claim', ticket, { key: 'sim-session', holder: 'shadow', ttlMs: 1 })
    await new Promise((r) => setTimeout(r, 20))
    const retry = await post(gw.base, '/v1/claim', ticket, { key: 'sim-session', holder: 'app', ttlMs: 60000 })
    evidence.check('claim:retry-after-release', released.status === 200 && retry.status === 200, `release ${released.status} retry ${retry.status}`)
    return evidence.finish({
      sim: 'sim-claim-conflict', endpoint: gw.base, shots: [start, sent.typed, sent.done],
      control_mock: ['soter-devtools'],
    })
  } finally {
    await app.close()
  }
}

const mode = modeOf()
await runModes({
  sim: 'sim-claim-conflict',
  mode,
  mock: async () => {
    const gw = await startLiveGateway()
    try { return await conflict('mock', gw) } finally { await gw.close() }
  },
  live: async () => {
    const evidence = openEvidence(dir, 'live')
    const app = await openPhone()
    try {
      const shots = [await shot(app, evidence, '01-phone')]
      const sid = (await app.data()).state?.current?.sessionId
      if (!sid) throw new Error('真机没有当前会话')
      const rows = await phoneSteps(app, [
        { op: 'unlock' },
        { op: 'hold', path: '/v1/claim', auth: true, body: { key: sid, holder: 'shadow', ttlMs: 60000 } },
        { op: 'deny', path: '/v1/claim', auth: true, body: { key: sid, holder: 'app', ttlMs: 60000 } },
        { op: 'release', path: '/v1/claim', auth: true, body: { key: sid, holder: 'shadow', ttlMs: 1 } },
        { op: 'sleep', ms: 20 },
        { op: 'retry', path: '/v1/claim', auth: true, body: { key: sid, holder: 'app', ttlMs: 1000 } },
      ])
      await app.setData({ input: prompt })
      await app.eval('() => { const page = getCurrentPages().slice(-1)[0]; page.selectComponent("#composer").onSend() }')
      const text = JSON.stringify(await app.data())
      evidence.check('phone:conflict-visible', text.includes('会话写者冲突'), text.slice(0, 180))
      evidence.check('phone:hold', step(rows, 'hold')?.status === 200, `status ${step(rows, 'hold')?.status}`)
      evidence.check('phone:deny', step(rows, 'deny')?.status === 412 && step(rows, 'deny')?.holder === 'shadow', `status ${step(rows, 'deny')?.status}`)
      evidence.check('phone:retry', step(rows, 'retry')?.status === 200, `status ${step(rows, 'retry')?.status}`)
      shots.push(await shot(app, evidence, '02-after'), await shot(app, evidence, '03-done'))
      return evidence.finish({ sim: 'sim-claim-conflict', endpoint: PRODUCTION_BASE, shots, device: app.device, note: '真机 claim，短租约' })
    } finally { await app.close() }
  },
})
