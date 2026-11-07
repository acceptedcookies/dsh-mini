import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { devTicket, post, startLiveGateway } from '../lib/gateway.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(dir, 'fixtures/alarm.json'), 'utf8'))

async function alarm(mode) {
  const evidence = openEvidence(dir, mode)
  const gw = await startLiveGateway()
  const app = await openApp()
  try {
    const start = await bootWorkspace(app, evidence)
    const sent = await typeAndSend(app, evidence, 'alarm resume once')
    const ticket = await devTicket(gw.base, gw.admin, TEST_OID)
    const dueAt = Date.now() - 1000
    const key = `${dueAt}-${fixture.sessionId}`
    const body = JSON.stringify({ ...fixture, dueAt })
    const armed = await post(gw.base, '/v1/state/put-cas', ticket, {
      key: `alarms/${key}`, body, cond: { ifNoneMatch: '*' },
    })
    evidence.check('alarm:arm', armed.status === 200, JSON.stringify(armed.body))
    const due = await post(gw.base, '/v1/alarm/due', ticket, { now: Date.now() })
    evidence.check('alarm:due-lists', due.status === 200 && (due.body?.keys ?? []).includes(`alarms/${key}`), JSON.stringify(due.body?.keys ?? []))
    const first = await post(gw.base, '/v1/alarm/claim', ticket, { key, holder: 'sim-sweeper' })
    const second = await post(gw.base, '/v1/alarm/claim', ticket, { key, holder: 'sim-sweeper' })
    evidence.check('alarm:exactly-once', first.status === 200 && second.status === 404, `first ${first.status} second ${second.status}`)
    return evidence.finish({
      sim: 'sim-alarm-resume', endpoint: gw.base, shots: [start, sent.typed, sent.done],
      control_mock: ['clock-request-now', 'soter-devtools'],
      note: '云函数 sweeper 未在本进程代跑',
    })
  } finally {
    await app.close()
    await gw.close()
  }
}

const mode = modeOf()
await runModes({
  sim: 'sim-alarm-resume',
  mode,
  mock: () => alarm('mock'),
  live: async () => openEvidence(dir, 'live').finish({
    sim: 'sim-alarm-resume', status: 'live-blocked', endpoint: 'http://127.0.0.1:9095', shots: [],
    note: 'FRD1 测试网关已停止；不伪造云函数 sweeper',
  }),
})
