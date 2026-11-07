// 内存 S3：只实现 durable core 用到的 SigV4 面（Put/Get/Head/Delete/List + Range + 条件写）。
// 不是 MinIO。live 写面在 FRD1 测试网关停用期间用它承载真实 /v1/* 合同，
// 避免写到本机 9097 隧道背后的生产桶。签名规则与 cloud/durable/core.mjs 同型。
import { createHash, createHmac } from 'node:crypto'
import { createServer } from 'node:http'

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s, 'utf8').digest()

function uriDecode(s) {
  return decodeURIComponent(s.replace(/\+/g, ' '))
}

function parseAuth(header) {
  if (!header?.startsWith('AWS4-HMAC-SHA256 ')) return null
  const out = {}
  for (const part of header.slice('AWS4-HMAC-SHA256 '.length).split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  const cred = (out.Credential ?? '').split('/')
  return {
    accessKey: cred[0] ?? '',
    date: cred[1] ?? '',
    region: cred[2] ?? '',
    service: cred[3] ?? '',
    signed: (out.SignedHeaders ?? '').split(';').filter(Boolean),
    signature: out.Signature ?? '',
  }
}

function queryPairs(search) {
  if (search.length === 0) return []
  return search.slice(1).split('&').filter(Boolean).map((p) => {
    const i = p.indexOf('=')
    return i < 0 ? [uriDecode(p), ''] : [uriDecode(p.slice(0, i)), uriDecode(p.slice(i + 1))]
  })
}

export function startMemoryS3({ accessKey, secretKey, bucket }) {
  const objects = new Map()
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const deny = (status, code, message) => {
        res.writeHead(status, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`)
      }
      const auth = parseAuth(req.headers.authorization)
      if (auth === null || auth.accessKey !== accessKey || auth.service !== 's3') return deny(403, 'InvalidAccessKeyId', 'bad credential')
      const payloadHash = req.headers['x-amz-content-sha256'] ?? ''
      if (payloadHash !== sha256(body)) return deny(400, 'XAmzContentSHA256Mismatch', 'payload hash')
      const url = new URL(req.url, 'http://127.0.0.1')
      const headers = {}
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v)
      const canonHeaders = auth.signed.map((n) => `${n}:${String(headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('')
      const pairs = queryPairs(url.search)
      const canonQuery = pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${encodeRfc(k)}=${encodeRfc(v)}`).join('&')
      const canon = [req.method, url.pathname, canonQuery, canonHeaders, auth.signed.join(';'), payloadHash].join('\n')
      const amz = headers['x-amz-date'] ?? ''
      const scope = `${auth.date}/${auth.region}/${auth.service}/aws4_request`
      const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canon)].join('\n')
      let k = hmac(`AWS4${secretKey}`, auth.date)
      k = hmac(k, auth.region); k = hmac(k, 's3'); k = hmac(k, 'aws4_request')
      if (hmac(k, toSign).toString('hex') !== auth.signature) return deny(403, 'SignatureDoesNotMatch', 'bad signature')

      const root = `/${bucket}`
      const prefix = `${root}/`
      if (url.pathname !== root && !url.pathname.startsWith(prefix)) return deny(404, 'NoSuchBucket', bucket)
      const key = uriDecode(url.pathname.slice(prefix.length))
      const q = Object.fromEntries(pairs)
      const listing = url.pathname === root || q['list-type'] !== undefined

      if (req.method === 'PUT' && !listing) {
        const cur = objects.get(key)
        const match = strip(headers['if-match'])
        if (headers['if-none-match'] === '*' && cur !== undefined) { res.writeHead(412); return res.end() }
        if (match !== undefined && (cur === undefined || cur.etag !== match)) { res.writeHead(412); return res.end() }
        const etag = sha256(body)
        objects.set(key, { body, etag, type: headers['content-type'] ?? 'application/octet-stream' })
        res.writeHead(200, { etag: `"${etag}"` })
        return res.end()
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && !listing) {
        const cur = objects.get(key)
        if (cur === undefined) return deny(404, 'NoSuchKey', key)
        let start = 0
        let end = cur.body.length
        let status = 200
        const out = { etag: `"${cur.etag}"`, 'content-type': cur.type, 'accept-ranges': 'bytes' }
        const range = headers.range
        if (range?.startsWith('bytes=')) {
          const [a, b] = range.slice(6).split('-')
          start = Number(a || 0)
          end = b !== undefined && b !== '' ? Number(b) + 1 : cur.body.length
          status = 206
          out['content-range'] = `bytes ${start}-${Math.max(start, end) - 1}/${cur.body.length}`
        }
        const slice = cur.body.subarray(start, end)
        out['content-length'] = slice.length
        res.writeHead(status, out)
        return res.end(req.method === 'HEAD' ? undefined : slice)
      }
      if (req.method === 'DELETE' && !listing) {
        const cur = objects.get(key)
        const match = strip(headers['if-match'])
        if (match !== undefined && (cur === undefined || cur.etag !== match)) { res.writeHead(412); return res.end() }
        const removed = objects.delete(key)
        res.writeHead(removed ? 204 : 404)
        return res.end()
      }
      if (req.method === 'GET' && listing) {
        const p = q.prefix ?? ''
        const after = q['start-after'] ?? q.marker ?? ''
        const max = Number(q['max-keys'] ?? 1000)
        const keys = [...objects.keys()].filter((name) => name.startsWith(p) && (after === '' || name > after)).sort()
        const page = keys.slice(0, Number.isFinite(max) ? max : 1000)
        const truncated = keys.length > page.length
        const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated><NextContinuationToken>${escapeXml(page.at(-1) ?? '')}</NextContinuationToken>${page.map((name) => `<Contents><Key>${escapeXml(name)}</Key><Size>${objects.get(name).body.length}</Size></Contents>`).join('')}</ListBucketResult>`
        res.writeHead(200, { 'content-type': 'application/xml' })
        return res.end(xml)
      }
      deny(405, 'MethodNotAllowed', req.method)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        endpoint: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
        keys: (p = '') => [...objects.keys()].filter((k) => k.startsWith(p)),
      })
    })
  })
}

function strip(v) {
  return v === undefined ? undefined : v.replaceAll('"', '')
}
function encodeRfc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
function escapeXml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
