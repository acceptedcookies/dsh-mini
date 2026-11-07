import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, openSettings } from '../lib/app.mjs'
import { capture } from '../lib/screenshots.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { OTHER_OID, PRODUCTION_BASE, TEST_OID } from '../lib/env.mjs'
import { openPhone, phoneSteps, shot, step } from '../lib/phone.mjs'
import { devTicket, post, startLiveGateway } from '../lib/gateway.mjs'

const dir = dirname(fileURLToPath(import.meta.url))

async function surface(mode, base, { admin, production }) {
  const evidence = openEvidence(dir, mode)
  const app = await openApp()
  try {
    const start = await bootWorkspace(app, evidence)
    const settings = await openSettings(app, evidence, '02-settings')
    await app.relaunch('/pages/workspace/workspace')
    const back = await capture(app, evidence, '03-back', { route: 'pages/workspace/workspace' })
    const health = await fetch(`${base}/healthz`)
    evidence.check('prod:health', health.status === 200, `status ${health.status}`)
    const noTicket = await post(base, '/v1/state/get', '', { key: 'state/sim' })
    evidence.check('prod:no-ticket', noTicket.status === 401, `status ${noTicket.status}`)
    const dev = await fetch(`${base}/dev/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    evidence.check('prod:dev-hidden', production ? dev.status === 404 : dev.status === 403 || dev.status === 400, `status ${dev.status}`)
    if (!production && admin) {
      const mine = await devTicket(base, admin, TEST_OID)
      const other = await devTicket(base, admin, OTHER_OID)
      await post(base, '/v1/state/put-cas', other, { key: 'state/secret', body: 'other-only', cond: { ifNoneMatch: '*' } })
      const crossed = await post(base, '/v1/state/get', mine, { key: 'state/secret' })
      evidence.check('prod:oid-isolation', crossed.status === 404, `status ${crossed.status}`)
    } else {
      evidence.check('prod:no-write', true, 'live 只读，不写生产')
    }
    return evidence.finish({ sim: 'sim-production-surface', endpoint: base, shots: [start, settings, back], control_mock: production ? [] : ['local-test-entry'] })
  } finally { await app.close() }
}

const mode = modeOf()
await runModes({
  sim: 'sim-production-surface',
  mode,
  mock: async () => {
    const gw = await startLiveGateway()
    try { return await surface('mock', gw.base, { admin: gw.admin, production: false }) }
    finally { await gw.close() }
  },
  live: async () => {
    const evidence = openEvidence(dir, 'live')
    const app = await openPhone()
    try {
      const shots = [await shot(app, evidence, '01-phone')]
      const rows = await phoneSteps(app, [
        { op: 'health', path: '/healthz', method: 'GET' },
        { op: 'no-ticket', path: '/v1/state/get', body: { key: 'state/sim-live' } },
        { op: 'dev', path: '/dev/ticket', body: {} },
        { op: 'bad-ticket', path: '/v1/state/get', body: { key: 'state/sim-live' }, auth: false },
      ])
      const health = step(rows, 'health')
      const noTicket = step(rows, 'no-ticket')
      const dev = step(rows, 'dev')
      evidence.check('phone:health', health?.status === 200, `status ${health?.status}`)
      evidence.check('phone:no-ticket', noTicket?.status === 401, `status ${noTicket?.status}`)
      evidence.check('phone:dev-hidden', dev?.status === 404, `status ${dev?.status}`)
      shots.push(await shot(app, evidence, '02-after'), await shot(app, evidence, '03-done'))
      return evidence.finish({
        sim: 'sim-production-surface', endpoint: PRODUCTION_BASE, shots, device: app.device,
        note: '真机 wx.request 直接打公网，不经隧道，不写',
      })
    } finally { await app.close() }
  },
})
