import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, currentText, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { startLiveGateway, devTicket, post } from '../lib/gateway.mjs'
import { startScriptedLlm } from '../lib/mock-upstream.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(dir, 'fixtures/script.json'), 'utf8'))

async function journey(mode, base, ticket) {
  const prefix = '/v1'
  const evidence = openEvidence(dir, mode)
  const shots = []
  const app = await openApp()
  const llm = await startScriptedLlm({ text: fixture.text })
  try {
    shots.push(await bootWorkspace(app, evidence))
    const sent = await typeAndSend(app, evidence, fixture.prompt)
    shots.push(sent.typed, sent.done)
    const visible = currentText(sent.data).includes(fixture.prompt)
    evidence.check('app:prompt-visible', visible, currentText(sent.data).slice(0, 160))

    const created = await post(base, `${prefix}/state/put-cas`, ticket, {
      key: 'state/sim-boot', body: JSON.stringify({ turn: 1, prompt: fixture.prompt }), cond: { ifNoneMatch: '*' },
    })
    evidence.check('state:create', created.status === 200, JSON.stringify(created.body).slice(0, 120))
    const read = await post(base, `${prefix}/state/get`, ticket, { key: 'state/sim-boot' })
    evidence.check('state:reload', read.status === 200 && read.body?.body?.includes(fixture.prompt), `status ${read.status}`)
    const race = await post(base, `${prefix}/state/put-cas`, ticket, {
      key: 'state/sim-boot', body: JSON.stringify({ turn: 2 }), cond: { ifMatch: 'stale-etag' },
    })
    evidence.check('state:stale-etag-412', race.status === 412, `status ${race.status}`)

    return evidence.finish({
      sim: 'sim-boot-session', endpoint: base, shots,
      control_mock: mode === 'live' ? ['soter-devtools'] : ['llm-upstream'],
      note: `scripted upstream ${llm.base}`,
    })
  } finally {
    await llm.close()
    await app.close()
  }
}

const mode = modeOf()
await runModes({
  sim: 'sim-boot-session',
  mode,
  mock: async () => {
    const gw = await startLiveGateway()
    try {
      return await journey('mock', gw.base, await devTicket(gw.base, gw.admin, TEST_OID))
    } finally { await gw.close() }
  },
  live: async () => openEvidence(dir, 'live').finish({
    sim: 'sim-boot-session', status: 'live-blocked', endpoint: 'http://127.0.0.1:9095', shots: [],
    control_mock: ['soter-devtools'],
    note: 'FRD1 测试网关已停止；本地内存 S3 不记 live-pass',
  }),
})
