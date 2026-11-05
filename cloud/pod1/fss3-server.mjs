// fss3-server —— POD1 durable 基座：fs 模拟 pgs3（不建 pg）+ dsh-mini 收窄 API。
//
// 监听面：
//   A  API_PORT（默认 127.0.0.1:9095，NPM 公网入口 dsh-mini.haimang.com.cn）：
//      GET  /healthz
//      POST /v1/state/{get,put-cas} /v1/claim /v1/alarm/{due,claim}
//           —— worker.mjs fetch handler 同码委派（env.S3_ENDPOINT=本机 S3 面，同源兑现）
//      POST /v1/vfs/{put,get,del,list}   vfs 键区对象面（≤8MB，MN02 扩约登记 todo.MN02 §0.2.3）
//      POST /v1/artifacts/publish        → {url,sha256}（artifacts 公网出口 G4）
//      GET  /a/{sha256}[.{ext}]          公网 artifacts 读面（content-hash 寻址、不列举、不鉴权）
//      POST /dev/ticket                  ADMIN_TOKEN 闸铸票（测试/排障面，x-admin-token 头）
//      GET  /dev/stats                   ADMIN_TOKEN 闸仓统计
//   B  S3_PORT（默认 127.0.0.1:9096，UFW 开放即「特定 minio 出口」）：
//      GET/HEAD/PUT/DELETE /{bucket}/{key}；GET /{bucket}?list-type=2&prefix=
//      SigV4 header 全验签；凭证 env-only（ACCESS_KEY/SECRET_KEY 在 /srv/dsh-mini/etc/fss3.env）。
//
// env：DATA_DIR TICKET_SECRET ADMIN_TOKEN ACCESS_KEY SECRET_KEY
//      BUCKET(默认 dsh-mini-fss3) PUBLIC_BASE(默认 https://dsh-mini.haimang.com.cn)
//      API_PORT API_BIND(默认 127.0.0.1；POD1 上 0.0.0.0 供 NPM 容器经 172.31.0.1 回源，UFW 挡公网)
//      S3_PORT S3_BIND(默认 127.0.0.1)
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, validKey, sha256Hex } from "./fss3-store.mjs";

import worker from "../worker/worker.mjs";
const require = createRequire(import.meta.url);
const { signTicket, verifyTicket } = require("../lib/ticket.cjs");

const env = process.env;
const DATA_DIR = env.DATA_DIR ?? "/srv/dsh-mini/data";
const TICKET_SECRET = env.TICKET_SECRET ?? "";
const ADMIN_TOKEN = env.ADMIN_TOKEN ?? "";
const ACCESS_KEY = env.ACCESS_KEY ?? "";
const SECRET_KEY = env.SECRET_KEY ?? "";
// fail-closed：TICKET_SECRET 缺位时 HMAC("") 仍可铸出「合法」票据——宁可起不来，不可放行。
if (TICKET_SECRET === "") { console.error("[fss3] TICKET_SECRET missing — refuse to start"); process.exit(1); }
if (ACCESS_KEY === "" || SECRET_KEY === "") { console.error("[fss3] S3 ACCESS_KEY/SECRET_KEY missing — refuse to start"); process.exit(1); }
const BUCKET = env.BUCKET ?? "dsh-mini-fss3";
const PUBLIC_BASE = (env.PUBLIC_BASE ?? "https://dsh-mini.haimang.com.cn").replace(/\/$/, "");
const API_PORT = Number(env.API_PORT ?? 9095);
const API_BIND = env.API_BIND ?? "127.0.0.1";
const S3_PORT = Number(env.S3_PORT ?? 9096);
const S3_BIND = env.S3_BIND ?? "127.0.0.1";
const VFS_MAX = 8 * 1024 * 1024;
const API_MAX_BODY = 16 * 1024 * 1024;

const store = createStore(DATA_DIR);
const log = (...a) => console.log(`[fss3 ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ── 小工具 ────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const readBody = (req, max = API_MAX_BODY) =>
  new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.byteLength;
      if (n > max) { reject(new Error("body-too-large")); req.destroy(); return; }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
const json = (res, status, obj) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "content-type": "application/json" });
  res.end(b);
};
const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const EXT_BY_MIME = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
  "image/webp": ".webp",
  "application/json": ".json", "text/markdown": ".md", "text/plain": ".txt",
  "application/pdf": ".pdf",
};
// artifacts 公网域白名单：html/svg 类可执行 mime 一律拒（nosniff 不足以挡正确-mime 活动内容）。
const ARTIFACT_MIMES = new Set(Object.keys(EXT_BY_MIME));

function ticketPayload(req, scope = "byok-proxy") {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return verifyTicket(TICKET_SECRET, token, scope);
}

/** vfs 线键 `vfs/{rest}` → 全键 `dsh-mini/vfs/{openid}/{rest}`；同 worker rest 校验。 */
const vfsFull = (key, openid) => {
  const m = typeof key === "string" && key.match(/^vfs\/(.+)$/);
  if (m === null || /(^|\/)\.\.(\/|$)|\/\/|^\/|dsh-mini/.test(m[1])) return null;
  return `dsh-mini/vfs/${openid}/${m[1]}`;
};

// ── SigV4 验签（S3 面）─────────────────────────────────────────────────
const hmacBuf = (k, m) => createHmac("sha256", typeof k === "string" ? Buffer.from(k) : k).update(m).digest();
const shaBuf = (d) => createHash("sha256").update(d).digest();

function verifySigV4(req, rawPath, rawQuery, body) {
  const auth = req.headers.authorization ?? "";
  const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
  if (m === null) return { ok: false, error: "malformed-authorization" };
  const [, ak, date, region, signedHeaders, sig] = m;
  if (ak !== ACCESS_KEY) return { ok: false, error: "bad-access-key" };
  const payloadHash = req.headers["x-amz-content-sha256"];
  if (typeof payloadHash !== "string") return { ok: false, error: "missing-payload-hash" };
  if (shaBuf(body).toString("hex") !== payloadHash) return { ok: false, error: "payload-hash-mismatch" };
  const headerMap = {};
  for (const [k, v] of Object.entries(req.headers)) headerMap[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  headerMap.host = req.headers.host ?? "";
  const names = signedHeaders.split(";");
  const canonHeaders = names.map((n) => `${n}:${headerMap[n] ?? ""}\n`).join("");
  const amzDate = req.headers["x-amz-date"];
  const canon = [req.method, rawPath, rawQuery ?? "", canonHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, shaBuf(enc.encode(canon)).toString("hex")].join("\n");
  let k = hmacBuf(`AWS4${SECRET_KEY}`, date);
  k = hmacBuf(k, region); k = hmacBuf(k, "s3"); k = hmacBuf(k, "aws4_request");
  const expect = hmacBuf(k, toSign).toString("hex");
  return expect.length === sig.length && timingSafeEqual(Buffer.from(expect), Buffer.from(sig))
    ? { ok: true }
    : { ok: false, error: "signature-mismatch" };
}

const uriEnc = (s, keepSlash = true) =>
  [...enc.encode(s)].map((b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/") ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");

const s3Err = (res, status, code, msg) => {
  const b = Buffer.from(`<Error><Code>${code}</Code><Message>${xmlEscape(msg)}</Message></Error>`);
  res.writeHead(status, { "content-type": "application/xml" });
  res.end(b);
};

// ── S3 面（9096）───────────────────────────────────────────────────────
const s3Server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
    const raw = req.url.split("?")[0]; // 签名面 canonical URI 用原始路径（客户端 uri() 已编码）
    const body = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : await readBody(req, 64 * 1024 * 1024);
    const auth = verifySigV4(req, raw, url.search.slice(1), body);
    if (!auth.ok) return s3Err(res, 403, "SignatureDoesNotMatch", auth.error);

    const segs = url.pathname.slice(1).split("/");
    const bucket = segs[0];
    let key;
    try {
      key = segs.slice(1).map(decodeURIComponent).join("/");
    } catch {
      return s3Err(res, 400, "InvalidKey", "bad percent-encoding");
    }
    if (bucket !== BUCKET) return s3Err(res, 404, "NoSuchBucket", bucket);

    // ListObjectsV2：GET /{bucket}?list-type=2&prefix=&max-keys=&start-after=/continuation-token=
    if ((req.method === "GET" || req.method === "HEAD") && key === "" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const maxKeys = Math.min(Number(url.searchParams.get("max-keys") ?? 1000), 1000);
      const startAfter = url.searchParams.get("continuation-token") ?? url.searchParams.get("start-after") ?? undefined;
      const objs = store.list(prefix, maxKeys + 1, startAfter);
      const truncated = objs.length > maxKeys;
      const page = truncated ? objs.slice(0, maxKeys) : objs;
      const contents = page.map((o) => `<Contents><Key>${xmlEscape(o.key)}</Key><Size>${o.size}</Size><ETag>&quot;${o.etag}&quot;</ETag><LastModified>${new Date(o.updated_ms).toISOString()}</LastModified></Contents>`).join("");
      const tokenXml = truncated ? `<NextContinuationToken>${xmlEscape(page[page.length - 1].key)}</NextContinuationToken>` : "";
      const out = `<ListBucketResult><Name>${xmlEscape(BUCKET)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${tokenXml}${contents}</ListBucketResult>`;
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(out);
    }

    if (!validKey(key)) return s3Err(res, 400, "InvalidKey", key.slice(0, 80));

    if (req.method === "PUT") {
      const r = store.put(key, body, {
        ifMatch: req.headers["if-match"], ifNoneMatch: req.headers["if-none-match"],
        contentType: req.headers["content-type"],
      });
      if (r.status === 412) return s3Err(res, 412, "PreconditionFailed", "etag condition failed");
      res.writeHead(200, { etag: `"${r.etag}"` });
      return res.end();
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const range = req.headers.range;
      const m = typeof range === "string" ? range.match(/^bytes=(\d+)-(\d*)$/) : null;
      const r = m !== null
        ? store.getRange(key, Number(m[1]), m[2] === "" ? undefined : Number(m[2]) - Number(m[1]) + 1)
        : store.get(key);
      if (r === null) return s3Err(res, 404, "NoSuchKey", key);
      const status = m !== null ? 206 : 200;
      const headers = { "content-type": r.content_type, "content-length": r.body.byteLength, etag: `"${r.etag}"`, "accept-ranges": "bytes" };
      if (status === 206) headers["content-range"] = `bytes ${m[1]}-${Number(m[1]) + r.body.byteLength - 1}/${r.total}`;
      res.writeHead(status, headers);
      return res.end(req.method === "HEAD" ? undefined : r.body);
    }
    if (req.method === "DELETE") {
      const r = store.del(key, { ifMatch: req.headers["if-match"] });
      if (r.status === 412) return s3Err(res, 412, "PreconditionFailed", "etag condition failed");
      if (r.status === 404) return s3Err(res, 404, "NoSuchKey", key);
      res.writeHead(204);
      return res.end();
    }
    return s3Err(res, 405, "MethodNotAllowed", req.method);
  } catch (e) {
    return s3Err(res, 500, "InternalError", String(e.message ?? e).slice(0, 200));
  }
});

// ── API 面（9095）───────────────────────────────────────────────────────
// worker.mjs 委派 env：S3_ENDPOINT 回本机 S3 面（同源兑现：worker 代码零改）。
const workerEnv = () => ({
  S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
  S3_BUCKET: BUCKET,
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: ACCESS_KEY,
  S3_SECRET_ACCESS_KEY: SECRET_KEY,
  TICKET_SECRET,
});

const apiServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/healthz") {
      return json(res, 200, { ok: true, role: "fss3", uptime_s: Math.floor(process.uptime()), ...store.stats() });
    }

    // artifacts 公网读面：/a/{sha64}[.{ext}]——content-hash 寻址，不列举，不鉴权。
    if (req.method === "GET" && path.startsWith("/a/")) {
      const name = path.slice(3).split(".")[0];
      if (!/^[0-9a-f]{64}$/.test(name)) return json(res, 404, { error: "not-found" });
      const r = store.get(`dsh-mini/artifacts-pub/${name}`);
      if (r === null) return json(res, 404, { error: "not-found" });
      res.writeHead(200, {
        "content-type": r.content_type, "content-length": r.body.byteLength,
        etag: `"${r.etag}"`, "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      return res.end(r.body);
    }

    // 管理面：ADMIN_TOKEN 闸（铸票/统计——测试与排障用，不进生产合同）。
    if (path.startsWith("/dev/")) {
      if (ADMIN_TOKEN === "" || req.headers["x-admin-token"] !== ADMIN_TOKEN) return json(res, 403, { error: "admin token required" });
      if (req.method === "POST" && path === "/dev/ticket") {
        let j;
        try { j = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}"); } catch { return json(res, 400, { error: "bad json" }); }
        if (typeof j.oid !== "string" || j.oid.length === 0) return json(res, 400, { error: "oid required" });
        const now = Math.floor(Date.now() / 1000);
        const ttl = Math.min(Number(j.ttl_s ?? 1800), 90 * 86400);
        const ticket = signTicket(TICKET_SECRET, {
          oid: j.oid, scope: j.scope ?? "byok-proxy", jti: randomBytes(8).toString("base64url"),
          iat: now, exp: now + ttl,
        });
        return json(res, 200, { ticket, exp: now + ttl });
      }
      if (req.method === "GET" && path === "/dev/stats") {
        return json(res, 200, { ok: true, ...store.stats() });
      }
      return json(res, 404, { error: `no dev route ${path}` });
    }

    /** JSON body 解析失败 → 400 而非 500。 */
    const parseJson = async (req, max) => {
      const raw = (await readBody(req, max)).toString("utf8");
      try { return JSON.parse(raw || "{}"); } catch { return null; }
    };

    if (req.method === "POST" && path === "/v1/artifacts/publish") {
      const payload = ticketPayload(req);
      if (!payload?.oid) return json(res, 401, { error: "byok ticket required" });
      const j = await parseJson(req, VFS_MAX * 2);
      if (j === null) return json(res, 400, { error: "bad json" });
      const mime = typeof j.mime === "string" ? j.mime : "application/octet-stream";
      if (!ARTIFACT_MIMES.has(mime) && mime !== "application/octet-stream") {
        return json(res, 400, { error: "mime not allowed (executable/active content rejected)" });
      }
      const bytes = Buffer.from(String(j.bytes_b64 ?? ""), "base64");
      if (bytes.byteLength === 0 || bytes.byteLength > VFS_MAX) return json(res, 400, { error: "bytes_b64 required (≤8MB)" });
      const sha = sha256Hex(bytes);
      const key = `dsh-mini/artifacts-pub/${sha}`;
      if (store.head(key) === null) {
        store.put(key, bytes, { contentType: mime });
      }
      const ext = EXT_BY_MIME[mime] ?? "";
      log(`artifacts/publish oid=${payload.oid} sha=${sha.slice(0, 12)} ${bytes.byteLength}B`);
      return json(res, 200, { sha256: sha, url: `${PUBLIC_BASE}/a/${sha}${ext}`, object_key: key });
    }

    if (req.method === "POST" && path.startsWith("/v1/vfs/")) {
      const payload = ticketPayload(req);
      if (!payload?.oid) return json(res, 401, { error: "byok ticket required" });
      const openid = payload.oid;
      const ep = path.slice("/v1/vfs/".length);
      const j = await parseJson(req, VFS_MAX * 2);
      if (j === null) return json(res, 400, { error: "bad json" });
      if (ep === "put") {
        const k = vfsFull(j.key, openid);
        if (k === null) return json(res, 400, { error: "bad key shape" });
        const bytes = Buffer.from(String(j.bytes_b64 ?? ""), "base64");
        if (bytes.byteLength > VFS_MAX) return json(res, 413, { error: "vfs body > 8MB" });
        if (typeof j.sha256 === "string" && j.sha256 !== sha256Hex(bytes)) {
          return json(res, 400, { error: "sha256 mismatch" });
        }
        const r = store.put(k, bytes, {
          ifMatch: typeof j.if_match === "string" ? j.if_match : undefined,
          ifNoneMatch: j.if_none_match === true ? "*" : undefined,
          contentType: typeof j.mime === "string" ? j.mime : "application/octet-stream",
        });
        if (r.status === 412) return json(res, 412, { error: "exists" });
        return json(res, 200, { etag: r.etag, size: bytes.byteLength, object_key: k });
      }
      if (ep === "get") {
        const k = vfsFull(j.key, openid);
        if (k === null) return json(res, 400, { error: "bad key shape" });
        const offset = Math.max(0, Number(j.offset ?? 0));
        const maxBytes = typeof j.max_bytes === "number" ? Math.max(0, j.max_bytes) : undefined;
        const r = store.getRange(k, offset, maxBytes);
        if (r === null) return json(res, 404, { error: "not-found" });
        return json(res, 200, { body_b64: r.body.toString("base64"), etag: r.etag, size: r.size, eof: offset + r.body.byteLength >= r.total });
      }
      if (ep === "del") {
        const k = vfsFull(j.key, openid);
        if (k === null) return json(res, 400, { error: "bad key shape" });
        return json(res, 200, { removed: store.del(k).status === 200 });
      }
      if (ep === "list") {
        const m = typeof j.prefix === "string" && j.prefix.match(/^vfs\/(.*)$/);
        if (m === null || /(^|\/)\.\.(\/|$)|\/\/|^\/|dsh-mini/.test(m[1])) return json(res, 400, { error: "bad prefix shape" });
        const limit = Math.min(Number(j.limit ?? 500), 1000);
        const startAfter = typeof j.start_after === "string" ? `dsh-mini/vfs/${openid}/${j.start_after.replace(/^vfs\//, "")}` : undefined;
        const objs = store.list(`dsh-mini/vfs/${openid}/${m[1]}`, limit + 1, startAfter);
        const page = objs.slice(0, limit).map((o) => `vfs/${o.key.slice(`dsh-mini/vfs/${openid}/`.length)}`);
        return json(res, 200, { keys: page, truncated: objs.length > limit, next_token: objs.length > limit ? page[page.length - 1] : undefined });
      }
      return json(res, 404, { error: `no vfs route ${ep}` });
    }

    // worker 五端点委派：/v1/state/* /v1/claim /v1/alarm/*——worker.mjs 同码 fetch handler。
    if (req.method === "POST" && path.startsWith("/v1/")) {
      const body = await readBody(req, 1024 * 1024);
      const wr = new Request(`${PUBLIC_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "application/json", authorization: req.headers.authorization ?? "" },
        body,
      });
      const wrres = await worker.fetch(wr, workerEnv());
      const text = await wrres.text();
      res.writeHead(wrres.status, { "content-type": wrres.headers.get("content-type") ?? "application/json" });
      return res.end(text);
    }

    return json(res, 404, { error: `no route ${path}` });
  } catch (e) {
    log(`error ${path}:`, e.message);
    return json(res, 500, { error: String(e.message ?? e).slice(0, 200) });
  }
});

apiServer.listen(API_PORT, API_BIND, () => {
  log(`api listening http://${API_BIND}:${API_PORT} (public: ${PUBLIC_BASE})`);
});
s3Server.listen(S3_PORT, S3_BIND, () => {
  log(`s3 listening http://${S3_BIND}:${S3_PORT} bucket=${BUCKET}`);
});
