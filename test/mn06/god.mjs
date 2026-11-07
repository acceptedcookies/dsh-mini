// MN06 God view —— 管理员 S3 直读 FRD1 测试 bucket（T-O-3/T-O-10）。
//
// 只读测试 bucket；断言 exact `dsh-mini/{kind}/{oid}/...` 键与字节。
// 不复用 App get 回读；POD1 审计是另一条只读 operator step，不在这里。
import { createHash, createHmac } from 'node:crypto'

const enc = new TextEncoder()
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const hmac = (k, m) => new Uint8Array(createHmac('sha256', typeof k === 'string' ? k : Buffer.from(k)).update(m).digest())
const sha = (d) => new Uint8Array(createHash('sha256').update(typeof d === 'string' ? d : Buffer.from(d)).digest())
const uri = (s, keep = true) => [...enc.encode(s)].map((b) => {
  const c = String.fromCharCode(b)
  return /[A-Za-z0-9\-._~]/.test(c) || (keep && c === '/') ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`
}).join('')
const xmlKeys = (xml) => [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1])
const xmlTag = (xml, tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]

export function createGod(env) {
  if (env.S3_BUCKET !== 'dsh-mini-test') throw new Error(`God view 只允许测试 bucket dsh-mini-test（当前 ${env.S3_BUCKET}）`)
  const endpoint = env.S3_ENDPOINT.replace(/\/$/, '')
  const bucket = env.S3_BUCKET
  const region = env.S3_REGION ?? 'us-east-1'

  async function s3(method, key, opts = {}) {
    const host = new URL(endpoint).host
    const path = `/${bucket}/${key}`
    const amz = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
    const date = amz.slice(0, 8)
    const body = opts.body === undefined ? Buffer.alloc(0) : Buffer.from(opts.body)
    const headers = {
      host,
      'x-amz-date': amz,
      'x-amz-content-sha256': hex(sha(body)),
      ...(opts.headers ?? {}),
    }
    const signed = Object.keys(headers).sort()
    const query = opts.query ?? ''
    const canon = [method, uri(path), query, signed.map((k) => `${k}:${headers[k]}\n`).join(''), signed.join(';'), headers['x-amz-content-sha256']].join('\n')
    const scope = `${date}/${region}/s3/aws4_request`
    let k = hmac(`AWS4${env.S3_SECRET_ACCESS_KEY}`, date); k = hmac(k, region); k = hmac(k, 's3'); k = hmac(k, 'aws4_request')
    const auth = `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${hex(hmac(k, ['AWS4-HMAC-SHA256', amz, scope, hex(sha(canon))].join('\n')))}`
    return fetch(`${endpoint}${uri(path)}${query ? `?${query}` : ''}`, {
      method,
      headers: { ...headers, authorization: auth },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
    })
  }

  async function keys(prefix) {
    const out = []
    let token
    for (;;) {
      const params = { 'list-type': '2', prefix, 'max-keys': '1000' }
      if (token !== undefined) params['continuation-token'] = token
      const q = Object.keys(params).sort()
        .map((k) => `${uri(k, false)}=${uri(String(params[k]), false)}`)
        .join('&')
      const r = await s3('GET', '', { query: q })
      if (!r.ok) throw new Error(`god LIST ${prefix} → ${r.status}`)
      const xml = await r.text()
      out.push(...xmlKeys(xml))
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null)
        : undefined
      if (token === null) throw new Error('god LIST truncated without continuation token')
      if (token === undefined) break
    }
    return out
  }

  async function get(key) {
    const r = await s3('GET', key)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`god GET ${key} → ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }

  return {
    bucket,
    endpoint,
    keys,
    get,
    async exists(key) { return (await get(key)) !== null },
    async json(key) {
      const b = await get(key)
      if (b === null) return null
      try { return JSON.parse(b.toString('utf8')) } catch { return null }
    },
    async stats() {
      const r = await fetch(`${env.DURABLE}/dev/stats`, { headers: { 'x-admin-token': env.ADMIN_TOKEN } })
      return { status: r.status, body: await r.json().catch(() => null) }
    },
  }
}

export const stateKey = (oid, rest) => `dsh-mini/state/${oid}/${rest}`
export const claimKey = (oid, sid) => `dsh-mini/claims/${oid}/${sid}`
export const vfsKey = (oid, rest) => `dsh-mini/vfs/${oid}/${rest}`
