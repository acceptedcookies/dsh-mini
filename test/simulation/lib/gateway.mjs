// live 写面：本地 dev.mjs + 内存 S3。真实 /v1/* 与 /dev/ticket，不碰生产桶。
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { FRD1_WRITE_BASE, REPO, loadGatewayEnv, liveWriteBase } from './env.mjs'
import { startMemoryS3 } from './memory-s3.mjs'

export async function openFrd1() {
  const envFile = loadGatewayEnv()
  const admin = clean(envFile.ADMIN_TOKEN)
  const health = await fetch(`${FRD1_WRITE_BASE}/healthz`).then((r) => r.json()).catch(() => null)
  if (health?.ok !== true) throw new Error(`FRD1 写面不可用 ${FRD1_WRITE_BASE}`)
  return {
    base: FRD1_WRITE_BASE,
    admin,
    bucket: health.bucket ?? '',
    async close() {},
  }
}

export async function startLiveGateway() {
  const envFile = loadGatewayEnv()
  const secret = clean(envFile.TICKET_SECRET)
  const admin = clean(envFile.ADMIN_TOKEN)
  const access = clean(envFile.S3_ACCESS_KEY_ID)
  const key = clean(envFile.S3_SECRET_ACCESS_KEY)
  if (![secret, admin, access, key].every((v) => (v ?? '').length > 0)) {
    throw new Error('gateway.env 缺 TICKET_SECRET/ADMIN_TOKEN/S3 凭证，live 写面无法启动')
  }
  const s3 = await startMemoryS3({ accessKey: access, secretKey: key, bucket: 'dsh-mini-test' })
  const base = new URL(liveWriteBase())
  const child = spawn(process.execPath, [join(REPO, 'cloud/durable/dev.mjs')], {
    env: {
      ...process.env,
      TICKET_SECRET: secret,
      ADMIN_TOKEN: admin,
      S3_ENDPOINT: s3.endpoint,
      S3_BUCKET: 'dsh-mini-test',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: access,
      S3_SECRET_ACCESS_KEY: key,
      API_PORT: base.port,
      API_BIND: '127.0.0.1',
      PUBLIC_BASE: base.origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const deadline = Date.now() + 8000
  let up = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    try {
      const r = await fetch(`${base.origin}/healthz`)
      if (r.ok) { up = true; break }
    } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  if (!up) {
    child.kill('SIGKILL')
    await s3.close()
    throw new Error(`live gateway 未就绪:\n${log.slice(-600)}`)
  }
  return {
    base: base.origin,
    admin,
    s3,
    async close() {
      child.kill('SIGTERM')
      await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 1500) })
      if (child.exitCode === null) child.kill('SIGKILL')
      await s3.close()
    },
  }
}

function clean(value) {
  return String(value ?? '').replace(/^﻿/, '').replace(/^["']|["']$/g, '').trim()
}

export async function devTicket(base, admin, oid, ttl = 1800) {
  const r = await fetch(`${base}/dev/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': admin },
    body: JSON.stringify({ oid, ttl_s: ttl }),
  })
  const body = await r.json().catch(() => null)
  if (r.status !== 200 || typeof body?.ticket !== 'string') {
    throw new Error(`/dev/ticket ${r.status} ${JSON.stringify(body).slice(0, 160)}`)
  }
  return body.ticket
}

export async function post(base, path, ticket, payload) {
  const headers = { 'content-type': 'application/json' }
  if (ticket) headers.authorization = `Bearer ${ticket}`
  const r = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) })
  const text = await r.text()
  let body = null
  try { body = text.length > 0 ? JSON.parse(text) : null } catch { body = text.slice(0, 300) }
  return { status: r.status, body }
}

export async function getRaw(base, path) {
  const r = await fetch(`${base}${path}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, headers: Object.fromEntries(r.headers), body: buf }
}
