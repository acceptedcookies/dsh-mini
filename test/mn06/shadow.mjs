// MN06 shadow —— Node 同协议客户端（T-O-3/T-O-6）。
//
// 真 /v1/* 合同 + 同 TEST_OID 票据；不 mock 数据面。
// owner 只是客户端标签（服务端以票 oid 注入），与 App 不同 owner 也落同一租户。
import '../mn01/wx-shim.mjs'
import { createRequire } from 'node:module'
import { createHmac, createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from './env.mjs'

const require = createRequire(join(ROOT, 'test/spike/package.json'))
const esbuild = require('esbuild')

const b64url = (b) => Buffer.from(b).toString('base64url')

export function signTicket(env, oid = env.TEST_OID, scope = 'byok-proxy', ttlS = 1800) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(JSON.stringify({ oid, scope, jti: randomUUID(), iat: now, exp: now + ttlS }))
  const sig = createHmac('sha256', env.TICKET_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function loadServices() {
  const entry = join(mkdtempSync(join(tmpdir(), 'mn06-shadow-')), 'entry.ts')
  writeFileSync(entry, `
import { createRemoteCas } from '${ROOT}/services/state/remote-cas'
import { createRemoteVfs } from '${ROOT}/services/vfs/remote'
import { createVfsSync } from '${ROOT}/services/vfs/remote-sync'
import { vfsStore } from '${ROOT}/services/vfs/store'
import { localObjects } from '${ROOT}/services/vfs/objects'
export { createRemoteCas, createRemoteVfs, createVfsSync, vfsStore, localObjects }
`)
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', write: false, platform: 'node', target: 'node18', logLevel: 'silent' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}

export async function createShadow(env, oid = env.TEST_OID) {
  const { createRemoteCas, createRemoteVfs, createVfsSync, vfsStore, localObjects } = await loadServices()
  const ticket = signTicket(env, oid)
  const post = async (url, headers, body) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const headers = () => ({ authorization: `Bearer ${ticket}` })
  const cas = createRemoteCas({ baseUrl: env.BASE, owner: 'shadow', headers, post })
  const remote = createRemoteVfs({ baseUrl: env.BASE, headers, post })
  const raw = async (ep, body) => {
    const r = await fetch(`${env.BASE}/v1/${ep}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ticket}` },
      body: JSON.stringify(body),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const enc = (s) => new TextEncoder().encode(s)
  const fullRow = (path) => `dsh-mini/state/shadow/${path}`
  const rowKey = (path) => `rows/${path.replace(/^\//, '')}`
  const sync = () => createVfsSync(remote)

  return {
    oid,
    ticket,
    cas,
    remote,
    raw,
    async claim(sid, holder = 'shadow', ttlMs = 60000) {
      return raw('claim', { key: sid, holder, ttlMs })
    },
    async putState(key, body, cond = { ifNoneMatch: '*' }) {
      return cas.putCas(fullRow(key), body, cond)
    },
    async getState(key) {
      return cas.get(fullRow(key))
    },
    async writeVfs(key, text, mime = 'text/plain') {
      const bytes = enc(text)
      return remote.put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { mime })
    },
    async readVfs(key) {
      return remote.get(key)
    },
    async delVfs(key) {
      return remote.del(key)
    },
    async row(path) {
      const r = await remote.get(rowKey(path))
      if (r === null) return null
      try { return JSON.parse(new TextDecoder().decode(r.bytes)) } catch { return null }
    },
    async object(sha) {
      const r = await remote.get(`objects/${sha}`)
      return r === null ? null : r.bytes
    },
    async listRows() {
      return remote.list('rows/', 1000)
    },
    async pullRows() {
      return sync().pullRows()
    },
    async hydrate(path) {
      return sync().hydrate(path)
    },
    async localRow(path) {
      return vfsStore.getRow(path)
    },
    async localBytes(sha) {
      try { return localObjects.read(sha) } catch { return null }
    },
    async stats() {
      const r = await fetch(`${env.DURABLE}/dev/stats`, { headers: { 'x-admin-token': env.ADMIN_TOKEN } })
      return { status: r.status, body: await r.json().catch(() => null) }
    },
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}
