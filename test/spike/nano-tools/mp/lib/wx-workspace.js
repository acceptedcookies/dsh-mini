// spike / nano-tools — wx.getFileSystemManager → WorkspaceFsLike adapter.
// Same lane mapping as the Node mock: /data|tmp|root|mnt|backup/** under
// ${wx.env.USER_DATA_PATH}/nspike/**. Implements the full seam incl.
// listWorkspaceRows pagination, statFile, readFileRange, CAS appendFile.
// NOTE: es2017-safe only — no ?? / ?. / object-spread / optional catch binding
// (DevTools device compile parses with a pre-es2019 parser when es6:false).
const { sha256 } = require('./sha256.js')
const fsm = wx.getFileSystemManager()
const ROOT = wx.env.USER_DATA_PATH + '/nspike'
const LANES = ['root', 'data', 'mnt', 'tmp', 'backup']
const enc = new TextEncoder()
const dec = new TextDecoder()

const or = (v, d) => (v === undefined || v === null) ? d : v
const opt = (v) => (v === undefined || v === null) ? undefined : v

const p = (fn) => (opts) => new Promise((res, rej) => fn(Object.assign({}, opts, { success: res, fail: rej })))
const _access = p(fsm.access.bind(fsm))
const _read = p(fsm.readFile.bind(fsm))
const _write = p(fsm.writeFile.bind(fsm))
const _mkdir = p(fsm.mkdir.bind(fsm))
const _readdirRaw = p(fsm.readdir.bind(fsm))
const _readdir = async (o) => (await _readdirRaw(o)).files
const _statRaw = p(fsm.stat.bind(fsm))
const _stat = async (o) => (await _statRaw(o)).stats
const _cp = p(fsm.copyFile.bind(fsm))
const _mv = p(fsm.rename.bind(fsm))
const _unlink = p(fsm.unlink.bind(fsm))
const _rmdir = p(fsm.rmdir.bind(fsm))

async function exists(rp) { try { await _access({ path: rp }); return true } catch (e) { return false } }
async function statOf(rp) {
  try { return await _stat({ path: rp }) } catch (e) { return null }
}
// mp stat: single → Stats; recursive → Stats[]
async function statIsDir(rp) {
  const st = await statOf(rp)
  if (!st) return null
  if (Array.isArray(st)) return null // shouldn't happen for non-recursive
  return st.isDirectory ? st.isDirectory() : (st.mode ? (st.mode & 0o170000) === 0o040000 : false)
}

function real(vpath) {
  if (vpath === '/' || vpath === '') return ROOT
  return ROOT + '/' + vpath.replace(/^\/+/, '')
}
function virt(rp) {
  return '/' + rp.slice(ROOT.length).replace(/^\/+/, '')
}
const loc = (vp) => ({ normalized_path: vp, persist_scope: 'session', durable_uuid: 'mock:' + vp })
const b64 = (s) => wx.arrayBufferToBase64(enc.encode(s).buffer)
const unb64 = (s) => dec.decode(wx.base64ToArrayBuffer(s))
const mtimeOf = (st) => st && st.lastModifiedTime ? new Date(st.lastModifiedTime * 1000).toISOString() : null

async function ensureDir(rp) {
  // mkdir -p on each segment BELOW ROOT (USER_DATA_PATH may carry a scheme
  // like http://usr — never split that prefix)
  const rel = rp.startsWith(ROOT) ? rp.slice(ROOT.length) : rp
  let cur = rp.slice(0, rp.length - rel.length)
  for (const seg of rel.split('/').filter(Boolean)) {
    cur += '/' + seg
    try { await _mkdir({ dirPath: cur, recursive: false }) } catch (e) { /* exists */ }
  }
}

async function walk(dir, depth, maxDepth, out) {
  if (depth > maxDepth) return
  let ents
  try { ents = await _readdir({ dirPath: dir }) } catch (e) { return }
  ents.sort()
  for (const name of ents) {
    const rp = dir + '/' + name
    const isDir = await statIsDir(rp)
    const st = await statOf(rp)
    out.push({ rp, vp: virt(rp), isDir: !!isDir, size: isDir ? 0 : or(st && st.size, 0), mtime: mtimeOf(st) })
    if (isDir && depth < maxDepth) await walk(rp, depth + 1, maxDepth, out)
  }
}

async function hashFile(rp) {
  try {
    const r = await _read({ filePath: rp }) // no encoding → ArrayBuffer
    return sha256(new Uint8Array(r.data))
  } catch (e) { return null }
}

function createWxWorkspace() {
  const seenIdem = new Map()

  const ws = {
    async readFile(vp) {
      try { const r = await _read({ filePath: real(vp), encoding: 'utf8' }); return typeof r.data === 'string' ? r.data : dec.decode(r.data) } catch (e) { return null }
    },
    async writeFile(vp, content, opts = {}) {
      const rp = real(vp)
      const existed = await exists(rp)
      if (opts.expected_content_hash != null) {
        const cur = await hashFile(rp)
        if (cur !== opts.expected_content_hash) { const e = new Error('content_hash mismatch on ' + vp); e.code = 'content-hash-mismatch'; throw e }
      }
      await ensureDir(rp.slice(0, rp.lastIndexOf('/')))
      const buf = enc.encode(String(content))
      await _write({ filePath: rp, data: buf.buffer })
      return { content_hash: sha256(buf), size_bytes: buf.length, mime: or(opts.mime, null), event_kind: existed ? 'file.write' : 'file.create', virtual_path: vp, tool_call_uuid: null }
    },
    async writeFileBytes(vp, content, opts = {}) {
      const rp = real(vp)
      const existed = await exists(rp)
      if (opts.expected_content_hash != null) {
        const cur = await hashFile(rp)
        if (cur !== opts.expected_content_hash) { const e = new Error('content_hash mismatch on ' + vp); e.code = 'content-hash-mismatch'; throw e }
      }
      await ensureDir(rp.slice(0, rp.lastIndexOf('/')))
      const u8 = content instanceof Uint8Array ? content : new Uint8Array(content)
      await _write({ filePath: rp, data: u8.buffer })
      return { content_hash: sha256(u8), size_bytes: u8.length, mime: or(opts.mime, null), event_kind: existed ? 'file.write' : 'file.create', virtual_path: vp, tool_call_uuid: null }
    },
    async listDir(vp, opts = {}) {
      const ents = []
      try {
        for (const name of await _readdir({ dirPath: real(vp) })) {
          if (opts.maxEntries && ents.length >= opts.maxEntries) break
          const st = await statOf(real(vp) + '/' + name)
          const isDir = await statIsDir(real(vp) + '/' + name)
          ents.push({ path: (vp === '/' ? '' : vp) + '/' + name, size: isDir ? 0 : or(st && st.size, 0) })
        }
      } catch (e) { }
      return ents
    },
    async glob(pattern, opts = {}) {
      const PH = '\u0001'
      const rx = new RegExp('^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, PH)
        .replace(/\*/g, '[^/]*')
        .replace(new RegExp(PH, 'g'), '.*')
        .replace(/\?/g, '[^/]') + '$')
      const cwd = opts.cwd || '/'
      const out = []
      const nodes = []
      await walk(real(cwd), 1, 32, nodes)
      for (const n of nodes) {
        const rel = n.vp.slice(cwd === '/' ? 1 : cwd.length).replace(/^\//, '')
        if (rx.test(rel) || rx.test(n.vp)) out.push(n.vp)
        if (opts.maxResults && out.length >= opts.maxResults) break
      }
      return out
    },
    async deleteFile(vp) { try { await _unlink({ filePath: real(vp) }); return true } catch (e) { return false } },
    async copyFile(s, d) { await ensureDir(real(d).slice(0, real(d).lastIndexOf('/'))); await _cp({ srcPath: real(s), destPath: real(d) }) },
    async moveFile(s, d) { await ensureDir(real(d).slice(0, real(d).lastIndexOf('/'))); await _mv({ oldPath: real(s), newPath: real(d) }) },
    async rename(o, n) { await _mv({ oldPath: real(o), newPath: real(n) }) },
    async mkdir(vp) {
      const rp = real(vp)
      const existed = await exists(rp)
      await ensureDir(rp)
      return { directory_uuid: 'mock:' + vp, virtual_path: vp, existed }
    },
    async rmdir(vp, recursive) { try { await _rmdir({ dirPath: real(vp), recursive: !!recursive }) } catch (e) { } },
    async statFile(vp) {
      const isDir = await statIsDir(real(vp))
      const st = await statOf(real(vp))
      if (isDir === null) return null
      if (isDir) return { size: 0, mtime: mtimeOf(st), mime: null, contentHash: null }
      return { size: or(st && st.size, 0), mtime: mtimeOf(st), mime: null, contentHash: await hashFile(real(vp)) }
    },
    async listWorkspaceRows(target, opts = {}) {
      const all = []
      const rp = real(target)
      const isDir = await statIsDir(rp)
      const st = await statOf(rp)
      if (isDir !== null || target === '/' || LANES.map(l => '/' + l).includes(target)) {
        all.push({
          entry_kind: isDir === false ? 'file' : 'directory',
          name: target.split('/').pop() || '/', virtual_path: target,
          size_bytes: isDir === false ? or(st && st.size, 0) : undefined,
          last_modified_at: opt(mtimeOf(st)),
          content_hash: isDir === false ? await hashFile(rp) : null,
          row_id: target, depth: 0,
        })
      }
      if (isDir !== false) {
        const nodes = []
        await walk(rp, 1, or(opts.maxDepth, 32), nodes)
        for (const n of nodes) {
          all.push({
            entry_kind: n.isDir ? 'directory' : 'file',
            name: n.vp.split('/').pop(), virtual_path: n.vp,
            size_bytes: n.isDir ? undefined : n.size,
            last_modified_at: opt(n.mtime),
            content_hash: n.isDir ? null : await hashFile(n.rp),
            row_id: n.vp, depth: n.vp.slice(target.length).split('/').filter(Boolean).length,
          })
        }
      }
      const start = opts.cursor ? parseInt(unb64(opts.cursor), 10) : 0
      const limit = or(opts.limit, all.length)
      const rows = all.slice(start, start + limit)
      const next = start + limit < all.length ? b64(String(start + limit)) : null
      return { rows, next_cursor: next, admission_mode: 'all', depth_truncated: false }
    },
    async readWorkspaceByteRanges(items) {
      const out = []
      for (const it of items) {
        try {
          const r = await _read({ filePath: real(it.path) })
          const buf = new Uint8Array(r.data)
          const cur = sha256(buf)
          if (it.expected_content_hash != null && cur !== it.expected_content_hash) { out.push({ status: 'changed' }); continue }
          out.push({ status: 'ok', bytes: buf.subarray(it.offset, it.offset + it.length), eof: it.offset + it.length >= buf.length, size_bytes: buf.length })
        } catch (e) { out.push({ status: 'missing' }) }
      }
      return { items: out }
    },
    async readFileRange(vp, opts) {
      try {
        const r = await _read({ filePath: real(vp) })
        const buf = new Uint8Array(r.data)
        const start = opts.suffix != null ? Math.max(0, buf.length - opts.suffix) : or(opts.offset, 0)
        const chunk = buf.subarray(start, Math.min(buf.length, start + opts.maxBytes))
        return { bytes: chunk, offset: start, eof: start + chunk.length >= buf.length, size: buf.length, mime: null, etag: sha256(buf), objectVersion: 'mock-1', release() { } }
      } catch (e) { return null }
    },
    async appendFile(vp, content, opts) { return appendImpl(vp, typeof content === 'string' ? enc.encode(content) : content, opts) },
    async appendFileBytes(vp, content, opts) { return appendImpl(vp, content, opts) },
    async classifyWorkspacePath(vp) {
      if (vp === '/' || LANES.map(l => '/' + l).includes(vp)) return { kind: 'workspace-root', path: vp }
      const isDir = await statIsDir(real(vp))
      if (isDir === null) return { kind: 'missing', path: vp }
      return { kind: isDir ? 'directory' : 'file', path: vp, location: loc(vp) }
    },
  }

  async function appendImpl(vp, u8, opts) {
    const rp = real(vp)
    if (seenIdem.has(opts.idempotencyKey)) return seenIdem.get(opts.idempotencyKey)
    let cur = new Uint8Array(0)
    try { const r = await _read({ filePath: rp }); cur = new Uint8Array(r.data) } catch (e) { }
    const etag = sha256(cur)
    if (cur.length !== opts.expectedSize || (opts.expectedEtag && etag !== opts.expectedEtag)) {
      const e = new Error('append CAS mismatch on ' + vp); e.code = 'cas-mismatch'; throw e
    }
    const merged = new Uint8Array(cur.length + u8.length); merged.set(cur); merged.set(u8, cur.length)
    await ensureDir(rp.slice(0, rp.lastIndexOf('/')))
    await _write({ filePath: rp, data: merged.buffer })
    const res = { size: merged.length, etag: sha256(merged), objectVersion: 'mock-1', alreadyApplied: false, effectState: 'committed' }
    seenIdem.set(opts.idempotencyKey, Object.assign({}, res, { alreadyApplied: true }))
    return res
  }

  return ws
}

// fetchImpl over wx.request — minimal Fetch surface consumed by network.ts:
// {status, statusText, headers.get(k), body.getReader(), text(), arrayBuffer()}
function wxFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const task = wx.request({
      url,
      method: init.method || 'GET',
      header: init.headers,
      data: init.body,
      responseType: 'arraybuffer',
      success(res) {
        const buf = res.data instanceof ArrayBuffer ? res.data : enc.encode(String(res.data)).buffer
        const hdrs = {}
        for (const k of Object.keys(res.header || {})) hdrs[k.toLowerCase()] = res.header[k]
        let done = false
        resolve({
          status: res.statusCode,
          statusText: '',
          url,
          headers: { get: (k) => or(hdrs[String(k).toLowerCase()], null) },
          body: { getReader: () => ({ read: async () => done ? { done: true } : (done = true, { done: false, value: new Uint8Array(buf) }), cancel: async () => { try { task.abort() } catch (e) { } } }) },
          text: async () => dec.decode(buf),
          arrayBuffer: async () => buf,
        })
      },
      fail(e) { reject(new Error('wx.request failed: ' + ((e && e.errMsg) || JSON.stringify(e)))) },
    })
    if (init.signal && typeof init.signal.addEventListener === 'function') {
      init.signal.addEventListener('abort', () => { try { task.abort() } catch (e) { } })
    }
  })
}

async function initLanes() {
  try { await _mkdir({ dirPath: ROOT }) } catch (e) { }
  for (const lane of LANES) { try { await _mkdir({ dirPath: ROOT + '/' + lane }) } catch (e) { } }
}

// wx fs persists across runs — H1 uses a fresh tmp dir per run, so S1/R2 must
// wipe the whole spike root first or write/tee hit file-exists from last run.
async function resetLanes() {
  try { await _rmdir({ dirPath: ROOT, recursive: true }) } catch (e) { }
  await initLanes()
}

module.exports = { createWxWorkspace, wxFetch, initLanes, resetLanes, sha256 }
