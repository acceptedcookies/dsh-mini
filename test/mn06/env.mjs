// MN06 env contract —— 单一 env 读取面（T-O-10）。
//
// 唯一真源：.anote/frd1/gateway.env（600，gitignored）。
// 不把 secret 写入仓库/日志；只允许 127.0.0.1:9095 的测试端点。
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const ENV_PATH = join(ROOT, '.anote/frd1/gateway.env')

export class EnvMissingError extends Error {
  constructor(missing) {
    super(`MN06 env missing: ${missing.join(', ')}`)
    this.name = 'EnvMissingError'
    this.missing = missing
  }
}

function parseEnvFile(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m !== null) out[m[1]] = m[2].trim()
  }
  return out
}

export function envFileMode() {
  try { return statSync(ENV_PATH).mode & 0o777 } catch { return null }
}

export function loadEnv(extra = {}) {
  let file = {}
  try { file = parseEnvFile(readFileSync(ENV_PATH, 'utf8')) } catch { /* missing -> requireEnv 报 */ }
  const merged = { ...file, ...process.env, ...extra }
  const durable = merged.DURABLE ?? merged.BASE ?? merged.PUBLIC_BASE ?? ''
  const env = {
    ...merged,
    BASE: (merged.BASE ?? durable).replace(/\/$/, ''),
    DURABLE: (merged.DURABLE ?? durable).replace(/\/$/, ''),
    TEST_OID: merged.TEST_OID ?? `mn06-${Date.now().toString(36)}`,
    TEST_OID2: merged.TEST_OID2 ?? `mn06-b-${Date.now().toString(36)}`,
    PATCH_UNLOCK: merged.PATCH_UNLOCK ?? '1',
    AUTO_PORT: merged.AUTO_PORT ?? '9602',
  }
  return env
}

export function assertLocalEndpoint(value, name) {
  let u
  try { u = new URL(value) } catch { throw new Error(`${name} 不是合法 URL: ${value}`) }
  const hostOk = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  if (!hostOk || u.port !== '9095' || u.protocol !== 'http:') {
    throw new Error(`${name} 必须指向 http://127.0.0.1:9095（当前 ${u.protocol}//${u.host}）`)
  }
}

export function assertMode600() {
  const mode = envFileMode()
  if (mode === null) throw new Error(`缺少 ${ENV_PATH}`)
  if (mode !== 0o600) throw new Error(`${ENV_PATH} 权限必须是 600（当前 ${mode.toString(8)}）`)
}

export function requireEnv(env, keys) {
  const missing = keys.filter((k) => typeof env[k] !== 'string' || env[k] === '')
  if (missing.length > 0) throw new EnvMissingError(missing)
}

/** 通过 dev 入口铸票（ADMIN_TOKEN 闸）；secret 只留在进程内。 */
export async function mintTicket(env, oid = env.TEST_OID, scope = 'byok-proxy') {
  const r = await fetch(`${env.DURABLE}/dev/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': env.ADMIN_TOKEN },
    body: JSON.stringify({ oid, scope, ttl_s: 1800 }),
  })
  if (r.status !== 200) throw new Error(`/dev/ticket → ${r.status}`)
  const j = await r.json()
  if (typeof j.ticket !== 'string') throw new Error('/dev/ticket 未返回 ticket')
  return j.ticket
}

export function report(suite, cases, extra = {}) {
  const payload = { suite, cases, ...extra }
  console.log(`MN06_REPORT ${JSON.stringify(payload)}`)
  return payload
}

export function isMain(metaUrl) {
  return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === metaUrl
}

const REQUIRED = ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']

if (isMain(import.meta.url)) {
  try {
    assertMode600()
    const env = loadEnv()
    assertLocalEndpoint(env.BASE, 'BASE')
    assertLocalEndpoint(env.DURABLE, 'DURABLE')
    requireEnv(env, REQUIRED)
    console.log(JSON.stringify({
      ok: true,
      base: env.BASE,
      mode600: true,
      keys: REQUIRED,
      test_oid: env.TEST_OID,
      s3_endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
    }))
  } catch (e) {
    console.error(`[env] ${e?.message ?? e}`)
    process.exit(3)
  }
}
