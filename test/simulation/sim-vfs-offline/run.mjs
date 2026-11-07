import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { devTicket, openFrd1, post, startLiveGateway } from '../lib/gateway.mjs'

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
    const gw = await openFrd1()
    try { return await offline('live', gw) } finally { await gw.close() }
  },
})
