// MN01-T09/T10 s3/pgs3 授权探针（可选门：env 缺省 → 诚实 SKIP，不伪装未观察）。
// env：S3_ENDPOINT/S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY
// 覆盖：PUT/GET/HEAD/Range/List/DELETE + If-Match/If-None-Match + 并发写矩阵。
// 用法：S3_ENDPOINT=... node test/mn01/s3-probe.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(repo, 'package.json'))
const crypto = require('node:crypto')

const { S3_ENDPOINT, S3_BUCKET, S3_REGION = 'us-east-1', S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
const configured = [S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY].every((v) => typeof v === 'string' && v.length > 0)
const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`) }

if (!configured) {
  // SKIP 用专用退出码 3——与 PASS(0)/FAIL(1) 可区分，防闸门误把 SKIP 当绿（审查）
  console.log('SKIP s3-probe：S3_* env 未配置（业主授权项 T10——未观察，不算 PASS 也不算 FAIL）')
  process.exit(3)
}
// 测试桶/端点白名单——防把 PUT/DELETE 侧载到生产桶（R3-18）。
if (S3_BUCKET !== 'dsh-mini-test' || !/^http:\/\/127\.0\.0\.1:(9000|9095)\/?$/.test(S3_ENDPOINT)) {
  console.log(`SKIP s3-probe：非测试桶/端点（bucket=${S3_BUCKET} endpoint=${S3_ENDPOINT}）`)
  process.exit(3)
}

// ── SigV4（与 worker.mjs 同实现，node:crypto 版）
const enc = new TextEncoder()
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const hmac = (k, m) => new Uint8Array(crypto.createHmac('sha256', typeof k === 'string' ? k : Buffer.from(k)).update(m).digest())
const sha = (d) => new Uint8Array(crypto.createHash('sha256').update(typeof d === 'string' ? d : Buffer.from(d)).digest())
const uri = (s, keep = true) => [...enc.encode(s)].map((b) => { const c = String.fromCharCode(b); return /[A-Za-z0-9\-._~]/.test(c) || (keep && c === '/') ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}` }).join('')

async function s3(method, key, opts = {}) {
  const host = new URL(S3_ENDPOINT).host
  const path = `/${S3_BUCKET}/${key}`
  const amz = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const date = amz.slice(0, 8)
  const headers = { host, 'x-amz-date': amz, 'x-amz-content-sha256': hex(sha(opts.body ?? '')), ...(opts.headers ?? {}) }
  const signed = Object.keys(headers).sort()
  const canon = [method, uri(path), opts.query ?? '', signed.map((k) => `${k}:${headers[k]}\n`).join(''), signed.join(';'), headers['x-amz-content-sha256']].join('\n')
  const scope = `${date}/${S3_REGION}/s3/aws4_request`
  let k = hmac(`AWS4${S3_SECRET_ACCESS_KEY}`, date); k = hmac(k, S3_REGION); k = hmac(k, 's3'); k = hmac(k, 'aws4_request')
  const auth = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${hex(hmac(k, ['AWS4-HMAC-SHA256', amz, scope, hex(sha(canon))].join('\n')))}`
  return fetch(`${S3_ENDPOINT.replace(/\/$/, '')}${uri(path)}${opts.query ? `?${opts.query}` : ''}`, { method, headers: { ...headers, authorization: auth, ...(opts.extraHeaders ?? {}) }, body: opts.body })
}

const K = `mn01-probe/${Date.now()}-obj`
try {
  const put = await s3('PUT', K, { body: 'v1' })
  check('PUT', put.ok, `→ ${put.status}`)
  const etag = (put.headers.get('etag') ?? '').replace(/"/g, '')
  const get = await s3('GET', K)
  check('GET', get.ok && (await get.text()) === 'v1', `→ ${get.status}`)
  const head = await s3('HEAD', K)
  check('HEAD', head.ok, `→ ${head.status}`)
  const range = await s3('GET', K, { extraHeaders: { range: 'bytes=1-1' } })
  check('Range', range.status === 206 && (await range.text()) === 'v1'.slice(1, 2), `→ ${range.status}`)
  const list = await s3('GET', '', { query: `list-type=2&prefix=${uri('mn01-probe/', false)}` })
  check('List', list.ok && (await list.text()).includes(K), `→ ${list.status}`)
  const condOk = await s3('PUT', K, { body: 'v2', extraHeaders: { 'if-match': `"${etag}"` } })
  check('If-Match', condOk.ok, `→ ${condOk.status}`)
  const stale = await s3('PUT', K, { body: 'v3', extraHeaders: { 'if-match': `"${etag}"` } })
  check('If-Match-stale-412', stale.status === 412, `→ ${stale.status}（pgs3/MinIO 条件写语义实测）`)
  const inn = await s3('PUT', K, { body: 'v4', extraHeaders: { 'if-none-match': '*' } })
  check('If-None-Match-*', inn.status === 412, `→ ${inn.status}`)
  // 共享前置 etag：两写者读同一版本后并发写——恰一胜一 412（probe 原实现各自 HEAD
  // 会把 HEAD2 排到 PUT1 之后，前置不确定；现钉死共享读版本）。
  const sharedEtag = (await s3('HEAD', K)).headers.get('etag')
  const [c1, c2] = await Promise.all([
    s3('PUT', K, { body: 'w1', extraHeaders: { 'if-match': sharedEtag } }),
    s3('PUT', K, { body: 'w2', extraHeaders: { 'if-match': sharedEtag } }),
  ])
  check('concurrent-etag-race', [c1.status, c2.status].sort().join(',') === '200,412', `→ ${c1.status},${c2.status}`)
} finally {
  await s3('DELETE', K)
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS  @ ${new Date().toISOString()}  endpoint=${S3_ENDPOINT}`)
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
