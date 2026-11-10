import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, newSession, openModels, openSettings } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { SIM_BASE } from '../lib/env.mjs'
import { openPhone, phoneSteps, shot, step } from '../lib/phone.mjs'
import { PRODUCTION_BASE } from '../lib/env.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(dir, 'fixtures/models.json'), 'utf8'))

async function routing(mode) {
  const evidence = openEvidence(dir, mode)
  const app = await openApp()
  try {
    const start = await bootWorkspace(app, evidence)
    const settings = await openSettings(app, evidence)
    const models = await openModels(app, evidence)
    const data = await app.data()
    const labels = JSON.stringify(data.models ?? data.model ?? data)
    evidence.check('engine:model-page', models.path.includes('models'), models.path)
    evidence.check('engine:lane-visible', fixture.visible.some((id) => labels.includes(id)), labels.slice(0, 180))
    await fetch(`${SIM_BASE}/sim/_bio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supported: false, enrolled: false }) }).catch(() => {})
    const challenge = await fetch(`${SIM_BASE}/sim/challenge`, { method: 'POST' }).then((r) => r.json())
    const off = await fetch(`${SIM_BASE}/sim/bio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: challenge.challenge }) })
    evidence.check('engine:bio-off', off.status === 403, `status ${off.status}`)
    await fetch(`${SIM_BASE}/sim/_bio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supported: true, enrolled: true }) })
    const again = await fetch(`${SIM_BASE}/sim/challenge`, { method: 'POST' }).then((r) => r.json())
    const proof = await fetch(`${SIM_BASE}/sim/bio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: again.challenge }) })
    evidence.check('engine:bio-on', proof.status === 200, `status ${proof.status}`)
    const badModel = await fetch(`${SIM_BASE}/sim/enroll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(await proof.json()), base_url: 'http://127.0.0.1:9/v1', model: fixture.rejected }),
    })
    evidence.check('engine:model-rejected', badModel.status === 401 || badModel.status === 403, `status ${badModel.status}`)
    return evidence.finish({
      sim: 'sim-engine-routing', endpoint: SIM_BASE, shots: [start, settings, models],
      control_mock: ['sim-bio'], deferred: mode === 'live' ? ['device-soter'] : [],
    })
  } finally {
    await fetch(`${SIM_BASE}/sim/_bio`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supported: true, enrolled: true }),
    }).catch(() => {})
    await app.close()
  }
}

const mode = modeOf()
await runModes({
  sim: 'sim-engine-routing',
  mode,
  mock: () => routing('mock'),
  live: async () => {
    const evidence = openEvidence(dir, 'live')
    const app = await openPhone()
    try {
      const shots = [await shot(app, evidence, '01-phone')]
      await app.eval('() => wx.setStorageSync("dsh:mini:engine:v1", "magpie")')
      await newSession(app)
      const createdData = await app.data()
      const sid = createdData.state?.current?.sessionId
      const engine = await app.eval(`() => {
        const id = ${JSON.stringify(sid)}
        const rows = wx.getStorageSync('dsh:sessions:v2') || []
        const row = rows.find((r) => r && r.summary && r.summary.id === id)
        return row && row.summary ? row.summary.engine : undefined
      }`)
      const rows = await phoneSteps(app, [
        { op: 'bio' },
        { op: 'unlock' },
      ])
      const bio = step(rows, 'bio')
      evidence.check('phone:soter', bio?.supported === true && bio?.enrolled === true, `supported ${bio?.supported} enrolled ${bio?.enrolled}`)
      evidence.check('phone:unlock', step(rows, 'unlock')?.ok === true, 'unlock')
      evidence.check('phone:engine', engine === 'nano-agent', String(engine))
      shots.push(await shot(app, evidence, '02-after'), await shot(app, evidence, '03-done'))
      return evidence.finish({ sim: 'sim-engine-routing', endpoint: PRODUCTION_BASE, shots, device: app.device, note: '真机生物识别与引擎存储' })
    } finally { await app.close() }
  },
})
