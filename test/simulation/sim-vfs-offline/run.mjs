import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { devTicket, post, startLiveGateway } from '../lib/gateway.mjs'
import { openPhone, phoneSteps, shot, step } from '../lib/phone.mjs'
import { PRODUCTION_BASE } from '../lib/env.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const bytes = readFileSync(join(dir, 'fixtures/note.txt'))
const key = 'vfs/rows/offline-note'

async function shots(evidence) {
  const app = await openApp()
  try {
    const start = await bootWorkspace(app, evidence)
    const sent = await typeAndSend(app, evidence, 'offline write then restore')
    return [start, sent.typed, sent.done]
  } finally { await app.close() }
}

async function offline(mode, gw) {
  const evidence = openEvidence(dir, mode)
  const images = await shots(evidence)
  const denied = await post(gw.base, '/v1/vfs/put', '', { key, bytes_b64: bytes.toString('base64') })
  evidence.check('offline:no-ticket', denied.status === 401, `status ${denied.status}`)
  const ticket = await devTicket(gw.base, gw.admin, TEST_OID)
  const put = await post(gw.base, '/v1/vfs/put', ticket, { key, bytes_b64: bytes.toString('base64') })
  evidence.check('offline:restored-write', put.status === 200, JSON.stringify(put.body).slice(0, 120))
  const del = await post(gw.base, '/v1/vfs/del', ticket, { key })
  const again = await post(gw.base, '/v1/vfs/get', ticket, { key })
  evidence.check('offline:delete-stays-dead', del.status === 200 && again.status === 404, `del ${del.status} get ${again.status}`)
  return evidence.finish({ sim: 'sim-vfs-offline', endpoint: gw.base, shots: images, control_mock: ['soter-devtools'] })
}

const mode = modeOf()
await runModes({
  sim: 'sim-vfs-offline',
  mode,
  mock: async () => {
    const gw = await startLiveGateway()
    try { return await offline('mock', gw) } finally { await gw.close() }
  },
  live: async () => {
    const evidence = openEvidence(dir, 'live')
    const app = await openPhone()
    try {
      const shots = [await shot(app, evidence, '01-phone')]
      const local = await app.eval(`() => {
        const key = 'dsh:vfs:v1:rows'
        const rows = wx.getStorageSync(key) || {}
        rows['/tmp/sim-live-offline'] = { virtual_path: '/tmp/sim-live-offline', text: 'offline row', updated_ms: Date.now() }
        wx.setStorageSync(key, rows)
        const tomb = 'dsh:mini:vfs-tombstones'
        const tombs = wx.getStorageSync(tomb) || {}
        tombs['/tmp/sim-live-deleted'] = { path: '/tmp/sim-live-deleted', updated_ms: Date.now() }
        wx.setStorageSync(tomb, tombs)
        return { row: Boolean(wx.getStorageSync(key)['/tmp/sim-live-offline']), tomb: Boolean(wx.getStorageSync(tomb)['/tmp/sim-live-deleted']) }
      }`)
      evidence.check('phone:local-row', local?.row === true, JSON.stringify(local))
      evidence.check('phone:local-tomb', local?.tomb === true, JSON.stringify(local))
      const rows = await phoneSteps(app, [
        { op: 'denied', path: '/v1/vfs/put', body: { key, bytes_b64: bytes.toString('base64') } },
        { op: 'unlock' },
        { op: 'put', path: '/v1/vfs/put', auth: true, body: { key, bytes_b64: bytes.toString('base64') } },
        { op: 'del', path: '/v1/vfs/del', auth: true, body: { key } },
        { op: 'gone', path: '/v1/vfs/get', auth: true, body: { key } },
      ])
      evidence.check('phone:no-ticket', step(rows, 'denied')?.status === 401, `status ${step(rows, 'denied')?.status}`)
      evidence.check('phone:restored', step(rows, 'put')?.status === 200, `status ${step(rows, 'put')?.status}`)
      evidence.check('phone:stays-dead', step(rows, 'del')?.status === 200 && step(rows, 'gone')?.status === 404, `del ${step(rows, 'del')?.status}`)
      shots.push(await shot(app, evidence, '02-after'), await shot(app, evidence, '03-done'))
      return evidence.finish({ sim: 'sim-vfs-offline', endpoint: PRODUCTION_BASE, shots, device: app.device, note: '真机先无票再解锁，测试行已删除' })
    } finally { await app.close() }
  },
})
