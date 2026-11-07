import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApp } from '../lib/devtools.mjs'
import { bootWorkspace, typeAndSend } from '../lib/app.mjs'
import { openEvidence } from '../lib/evidence.mjs'
import { modeOf, runModes } from '../lib/run.mjs'
import { TEST_OID } from '../lib/env.mjs'
import { devTicket, getRaw, post, startLiveGateway } from '../lib/gateway.mjs'
import { liveWithoutTunnel } from '../lib/live.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const bytes = readFileSync(join(dir, 'fixtures/file.txt'))

async function pageShots(evidence) {
  const app = await openApp()
  try {
    const start = await bootWorkspace(app, evidence)
    const sent = await typeAndSend(app, evidence, `vfs ${bytes.toString('utf8').trim()}`)
    return [start, sent.typed, sent.done]
  } finally {
    await app.close()
  }
}

async function roundtrip(mode, gw) {
  const evidence = openEvidence(dir, mode)
  try {
    const shots = await pageShots(evidence)
    const ticket = await devTicket(gw.base, gw.admin, TEST_OID)
    const put = await post(gw.base, '/v1/vfs/put', ticket, { key: 'vfs/rows/sim-file', bytes_b64: bytes.toString('base64'), mime: 'text/plain' })
    evidence.check('vfs:put', put.status === 200, JSON.stringify(put.body).slice(0, 140))
    const listed = await post(gw.base, '/v1/vfs/list', ticket, { prefix: 'vfs/rows/' })
    evidence.check('vfs:list', listed.status === 200 && (listed.body?.keys ?? []).some((k) => k.includes('sim-file')), JSON.stringify(listed.body?.keys ?? []).slice(0, 140))
    const range = await post(gw.base, '/v1/vfs/get', ticket, { key: 'vfs/rows/sim-file', offset: 0, max_bytes: 4 })
    const head = Buffer.from(range.body?.body_b64 ?? '', 'base64').toString('utf8')
    evidence.check('vfs:range', range.status === 200 && bytes.toString('utf8').startsWith(head), head)
    const traversal = await post(gw.base, '/v1/vfs/put', ticket, { key: 'vfs/../secret', bytes_b64: bytes.toString('base64') })
    evidence.check('vfs:traversal-rejected', traversal.status === 400, `status ${traversal.status}`)
    const overflow = await post(gw.base, '/v1/vfs/put', ticket, {
      key: 'vfs/rows/too-big', bytes_b64: Buffer.alloc(8 * 1024 * 1024 + 1, 1).toString('base64'),
    })
    evidence.check('vfs:over-8mb', overflow.status === 413 || overflow.status === 400, `status ${overflow.status}`)
    const published = await post(gw.base, '/v1/artifacts/publish', ticket, { bytes_b64: bytes.toString('base64'), mime: 'text/plain' })
    const sha = published.body?.sha256
    evidence.check('artifact:publish', published.status === 200 && typeof sha === 'string', JSON.stringify(published.body).slice(0, 160))
    const fetched = await getRaw(gw.base, `/a/${sha}`)
    evidence.check('artifact:public-read', fetched.status === 200 && fetched.body.equals(bytes), `status ${fetched.status} sha ${sha}`)
    const del = await post(gw.base, '/v1/vfs/del', ticket, { key: 'vfs/rows/sim-file' })
    evidence.check('vfs:del', del.status === 200, JSON.stringify(del.body))
    const gone = await post(gw.base, '/v1/vfs/get', ticket, { key: 'vfs/rows/sim-file' })
    evidence.check('vfs:gone', gone.status === 404, `status ${gone.status}`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    evidence.check('artifact:sha-matches', sha === digest, `${sha} vs ${digest}`)
    return evidence.finish({
      sim: 'sim-vfs-roundtrip', endpoint: gw.base, shots,
      control_mock: mode === 'mock' ? ['llm-upstream', 'soter-devtools'] : ['soter-devtools'],
    })
  } finally {
    await gw.close()
  }
}

const mode = modeOf()
await runModes({
  sim: 'sim-vfs-roundtrip',
  mode,
  mock: async () => {
    const gw = await startLiveGateway()
    try { return await roundtrip('mock', gw) } finally { await gw.close() }
  },
  live: () => liveWithoutTunnel(dir, 'sim-vfs-roundtrip'),
})
