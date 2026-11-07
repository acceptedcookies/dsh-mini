import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, currentText, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { devTicket, post, startLiveGateway } from '../lib/gateway.mjs'
import { liveWithoutTunnel } from '../lib/live.mjs'

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
  live: () => liveWithoutTunnel(dir, 'sim-claim-conflict'),
})
