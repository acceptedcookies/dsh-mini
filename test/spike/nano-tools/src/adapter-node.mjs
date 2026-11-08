// spike / nano-tools — Node fs → WorkspaceFsLike mock adapter (H1 only).
// Maps workspace virtual roots (/data,/tmp,/root,/mnt,/backup) onto subdirs
// of a tmp dir; implements the FULL seam incl. listWorkspaceRows pagination,
// statFile, readFileRange, CAS appendFile — so handlers exercise real paths.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const LANES = ['root', 'data', 'mnt', 'tmp', 'backup']
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

export function createNodeWorkspace(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true })
  for (const lane of LANES) fs.mkdirSync(path.join(rootDir, lane), { recursive: true })
  const seenIdem = new Map()

  // /data/spike/a.txt -> {root}/data/spike/a.txt ; '/' -> {root}
  function real(vpath) {
    if (vpath === '/' || vpath === '') return rootDir
    const p = vpath.replace(/^\/+/, '')
    return path.join(rootDir, p)
  }
  // real -> virtual
  function virt(rp) {
    const rel = path.relative(rootDir, rp).split(path.sep).join('/')
    return '/' + rel
  }
  const loc = (vp) => ({
    normalized_path: vp,
    persist_scope: 'session',
    durable_uuid: 'mock:' + vp,
  })

  async function statOf(rp) {
    try { return await fsp.stat(rp) } catch { return null }
  }

  async function* walk(dir, depth, maxDepth) {
    if (depth > maxDepth) return
    let ents
    try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of ents) {
      const rp = path.join(dir, e.name)
      const st = await statOf(rp)
      yield { rp, vp: virt(rp), isDir: e.isDirectory(), size: st?.size ?? 0, mtime: st?.mtime ?? null }
      if (e.isDirectory() && depth < maxDepth) yield* walk(rp, depth + 1, maxDepth)
    }
  }

  async function hashFile(rp) {
    try { return sha256(await fsp.readFile(rp)) } catch { return null }
  }

  const ws = {
    async readFile(vp) {
      try { return await fsp.readFile(real(vp), 'utf8') } catch { return null }
    },
    async writeFile(vp, content, opts = {}) {
      const rp = real(vp)
      const existed = fs.existsSync(rp)
      if (opts.expected_content_hash != null) {
        const cur = await hashFile(rp)
        if (cur !== opts.expected_content_hash) {
          const e = new Error(`content_hash mismatch on ${vp}`)
          e.code = 'content-hash-mismatch'
          throw e
        }
      }
      await fsp.mkdir(path.dirname(rp), { recursive: true })
      const buf = Buffer.from(content, 'utf8')
      await fsp.writeFile(rp, buf)
      return {
        content_hash: sha256(buf), size_bytes: buf.length, mime: opts.mime ?? null,
        event_kind: existed ? 'file.write' : 'file.create',
        virtual_path: vp, tool_call_uuid: null,
      }
    },
    async writeFileBytes(vp, content, opts = {}) {
      const rp = real(vp)
      const existed = fs.existsSync(rp)
      if (opts.expected_content_hash != null) {
        const cur = await hashFile(rp)
        if (cur !== opts.expected_content_hash) {
          const e = new Error(`content_hash mismatch on ${vp}`); e.code = 'content-hash-mismatch'; throw e
        }
      }
      await fsp.mkdir(path.dirname(rp), { recursive: true })
      const buf = Buffer.from(content)
      await fsp.writeFile(rp, buf)
      return {
        content_hash: sha256(buf), size_bytes: buf.length, mime: opts.mime ?? null,
        event_kind: existed ? 'file.write' : 'file.create',
        virtual_path: vp, tool_call_uuid: null,
      }
    },
    async listDir(vp, opts = {}) {
      const ents = []
      try {
        for (const e of await fsp.readdir(real(vp), { withFileTypes: true })) {
          if (opts.maxEntries && ents.length >= opts.maxEntries) break
          const st = await statOf(path.join(real(vp), e.name))
          ents.push({ path: (vp === '/' ? '' : vp) + '/' + e.name, size: st?.size ?? 0 })
        }
      } catch { /* missing dir → empty */ }
      return ents
    },
    async glob(pattern, opts = {}) {
      // minimal glob: ** → any depth, * → segment wild; over walk of cwd
      const cwd = opts.cwd || '/'
      const rx = new RegExp('^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '[^/]*')
        .replace(//g, '.*')
        .replace(/\?/g, '[^/]') + '$')
      const out = []
      const base = cwd === '/' ? '' : cwd
      for await (const n of walk(real(base || '/'), 1, 32)) {
        const rel = n.vp.slice(base.length) || n.vp
        if (rx.test(rel.replace(/^\//, '')) || rx.test(n.vp)) out.push(n.vp)
        if (opts.maxResults && out.length >= opts.maxResults) break
      }
      return out
    },
    async deleteFile(vp) {
      try { await fsp.unlink(real(vp)); return true } catch { return false }
    },
    async copyFile(src, dst) {
      await fsp.mkdir(path.dirname(real(dst)), { recursive: true })
      await fsp.copyFile(real(src), real(dst))
    },
    async moveFile(src, dst) {
      await fsp.mkdir(path.dirname(real(dst)), { recursive: true })
      await fsp.rename(real(src), real(dst))
    },
    async rename(o, n) { await fsp.rename(real(o), real(n)) },
    async mkdir(vp) {
      const rp = real(vp)
      const existed = fs.existsSync(rp)
      await fsp.mkdir(rp, { recursive: true })
      return { directory_uuid: 'mock:' + vp, virtual_path: vp, existed }
    },
    async rmdir(vp, recursive) {
      await fsp.rm(real(vp), { recursive: !!recursive, force: true })
    },
    async statFile(vp) {
      const st = await statOf(real(vp))
      if (!st || st.isDirectory()) return st?.isDirectory() ? { size: 0, mtime: st.mtime.toISOString(), mime: null, contentHash: null } : null
      return { size: st.size, mtime: st.mtime.toISOString(), mime: null, contentHash: await hashFile(real(vp)) }
    },
    async listWorkspaceRows(target, opts = {}) {
      const all = []
      const startRp = real(target)
      const st = await statOf(startRp)
      if (st) {
        all.push({
          entry_kind: st.isDirectory() ? 'directory' : 'file',
          name: path.basename(target) || '/', virtual_path: target,
          size_bytes: st.isDirectory() ? undefined : st.size,
          last_modified_at: st.mtime.toISOString(),
          content_hash: st.isDirectory() ? null : await hashFile(startRp),
          row_id: target, depth: 0,
        })
      }
      if (st?.isDirectory()) {
        for await (const n of walk(startRp, 1, opts.maxDepth ?? 32)) {
          all.push({
            entry_kind: n.isDir ? 'directory' : 'file',
            name: path.basename(n.rp), virtual_path: n.vp,
            size_bytes: n.isDir ? undefined : n.size,
            last_modified_at: n.mtime?.toISOString(),
            content_hash: n.isDir ? null : await hashFile(n.rp),
            row_id: n.vp, depth: n.vp.slice(target.length).split('/').filter(Boolean).length,
          })
        }
      }
      const start = opts.cursor ? parseInt(Buffer.from(opts.cursor, 'base64').toString(), 10) : 0
      const limit = opts.limit ?? all.length
      const rows = all.slice(start, start + limit)
      const next = start + limit < all.length ? Buffer.from(String(start + limit)).toString('base64') : null
      return { rows, next_cursor: next, admission_mode: 'all', depth_truncated: false }
    },
    async readWorkspaceByteRanges(items) {
      const out = []
      for (const it of items) {
        try {
          const buf = await fsp.readFile(real(it.path))
          const cur = sha256(buf)
          if (it.expected_content_hash != null && cur !== it.expected_content_hash) {
            out.push({ status: 'changed' }); continue
          }
          out.push({ status: 'ok', bytes: buf.subarray(it.offset, it.offset + it.length), eof: it.offset + it.length >= buf.length, size_bytes: buf.length })
        } catch { out.push({ status: 'missing' }) }
      }
      return { items: out }
    },
    async readFileRange(vp, opts) {
      try {
        const buf = await fsp.readFile(real(vp))
        const start = opts.suffix != null ? Math.max(0, buf.length - opts.suffix) : (opts.offset ?? 0)
        const chunk = buf.subarray(start, Math.min(buf.length, start + opts.maxBytes))
        return {
          bytes: chunk, offset: start, eof: start + chunk.length >= buf.length,
          size: buf.length, mime: null, etag: sha256(buf), objectVersion: 'mock-1',
          release() {},
        }
      } catch { return null }
    },
    async appendFile(vp, content, opts) {
      return appendImpl(vp, Buffer.from(content, 'utf8'), opts)
    },
    async appendFileBytes(vp, content, opts) {
      return appendImpl(vp, Buffer.from(content), opts)
    },
    async classifyWorkspacePath(vp) {
      if (vp === '/' || LANES.map(l => '/' + l).includes(vp)) return { kind: 'workspace-root', path: vp }
      const st = await statOf(real(vp))
      if (!st) return { kind: 'missing', path: vp }
      return { kind: st.isDirectory() ? 'directory' : 'file', path: vp, location: loc(vp) }
    },
  }

  async function appendImpl(vp, buf, opts) {
    const rp = real(vp)
    const idem = opts.idempotencyKey
    if (seenIdem.has(idem)) return seenIdem.get(idem)
    const cur = fs.existsSync(rp) ? await fsp.readFile(rp) : Buffer.alloc(0)
    const etag = sha256(cur)
    if (cur.length !== opts.expectedSize || (opts.expectedEtag && etag !== opts.expectedEtag)) {
      const e = new Error(`append CAS mismatch on ${vp}`); e.code = 'cas-mismatch'; throw e
    }
    await fsp.mkdir(path.dirname(rp), { recursive: true })
    await fsp.writeFile(rp, Buffer.concat([cur, buf]))
    const res = { size: cur.length + buf.length, etag: sha256(Buffer.concat([cur, buf])), objectVersion: 'mock-1', alreadyApplied: false, effectState: 'committed' }
    seenIdem.set(idem, { ...res, alreadyApplied: true })
    return res
  }

  return ws
}

// Convenience: seed fixture files into a lane
export async function seed(ws, files) {
  for (const [vp, content] of Object.entries(files)) {
    await ws.writeFile(vp, content)
  }
}
