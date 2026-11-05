// fss3-store —— 文件系统对象仓（pgs3 语义模拟：字节与条件写在 fs，不建 pg）。
// 语义面（与 context/pgs3/src/store.rs 对齐）：
//   对象 = key→文件；etag = 内容 sha256（带引号）；写 = tmp→rename 原子落盘；
//   条件写 = If-Match(etag)/If-None-Match(*) → 412；进程内同步读写天然单写者。
// 布局：{root}/objects/<enc(key)> 字节；{root}/meta/<enc(key)>.json 行元数据。
// key 规则：分段 '/' 分隔；每段不得为空/`.`/`..`/含控制字符/含 `\`；总长 < 1024。
import { createHash } from "node:crypto";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync,
  readdirSync, statSync, renameSync,
} from "node:fs";
import { dirname, join } from "node:path";

const encSeg = (s) => encodeURIComponent(s);

export function validKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length >= 1024) return false;
  if (key.startsWith("/") || key.endsWith("/")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\\]/.test(key)) return false;
  return key.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

export function createStore(root) {
  const objRoot = join(root, "objects");
  const metaRoot = join(root, "meta");
  const objPath = (key) => join(objRoot, ...key.split("/").map(encSeg));
  const metaPath = (key) => join(metaRoot, ...key.split("/").map(encSeg)) + ".json";

  const writeAtomic = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  };

  const readMeta = (key) => {
    try {
      return JSON.parse(readFileSync(metaPath(key), "utf8"));
    } catch {
      return null;
    }
  };

  return {
    /** 条件写：If-Match 须等当前 etag；If-None-Match:'*' 须当前不存在。返回 {status,etag}。 */
    put(key, buf, opts = {}) {
      const cur = readMeta(key);
      if (opts.ifNoneMatch === "*" && cur !== null) return { status: 412 };
      if (opts.ifMatch !== undefined) {
        const want = String(opts.ifMatch).replace(/"/g, "");
        if (cur === null || cur.etag !== want) return { status: 412 };
      }
      const etag = sha256Hex(buf);
      writeAtomic(objPath(key), buf);
      writeAtomic(metaPath(key), JSON.stringify({
        etag, size: buf.byteLength,
        content_type: opts.contentType ?? "application/octet-stream",
        updated_ms: Date.now(),
      }));
      return { status: 200, etag };
    },
    get(key) {
      const meta = readMeta(key);
      if (meta === null || !existsSync(objPath(key))) return null;
      return { body: readFileSync(objPath(key)), ...meta };
    },
    /** offset/len 切片读（Range 语义）。 */
    getRange(key, offset, len) {
      const r = this.get(key);
      if (r === null) return null;
      const end = len === undefined ? r.body.byteLength : Math.min(offset + len, r.body.byteLength);
      return { ...r, body: r.body.subarray(offset, end), total: r.body.byteLength };
    },
    head(key) {
      return readMeta(key);
    },
    del(key) {
      const had = existsSync(objPath(key));
      try { unlinkSync(objPath(key)); } catch { /* absent */ }
      try { unlinkSync(metaPath(key)); } catch { /* absent */ }
      return had;
    },
    /** 前缀列举：解码路径段还原 key；返回 {key,size,etag,updated_ms}。 */
    list(prefix = "", maxKeys = 1000) {
      const out = [];
      const walk = (dir, parts) => {
        if (out.length >= maxKeys) return;
        let ents;
        try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        ents.sort((a, b) => (a.name < b.name ? -1 : 1));
        for (const e of ents) {
          if (out.length >= maxKeys) return;
          if (e.isDirectory()) { walk(join(dir, e.name), [...parts, e.name]); continue; }
          const key = [...parts, e.name].map(decodeURIComponent).join("/");
          if (!key.startsWith(prefix)) continue;
          const meta = readMeta(key);
          if (meta === null) continue;
          out.push({ key, size: meta.size, etag: meta.etag, updated_ms: meta.updated_ms });
        }
      };
      walk(objRoot, []);
      return out;
    },
    /** 全键统计（诊断面）。 */
    stats() {
      let n = 0, bytes = 0;
      for (const o of this.list("", 1e6)) { n += 1; bytes += o.size; }
      return { objects: n, bytes };
    },
    /** 测试钩子：检查底层路径存在性。 */
    _paths: { objRoot, metaRoot },
    _existsRaw: (p) => existsSync(p) && statSync(p).isFile(),
  };
}
