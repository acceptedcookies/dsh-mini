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

async function offline(mode) {
  const evidence = openEvidence(dir, mode)
  const gw = await startLiveGateway()
  try {
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
  } finally { await gw.close() }
}

const mode = modeOf()
await runModes({
  sim: 'sim-vfs-offline',
  mode,
  mock: () => offline('mock'),
  live: async () => openEvidence(dir, 'live').finish({
    sim: 'sim-vfs-offline', status: 'live-blocked', endpoint: 'http://127.0.0.1:9095', shots: [],
    note: 'FRD1 测试网关已停止；本地内存 S3 不冒充 live',
  }),
})
