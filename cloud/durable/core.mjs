// durable core —— dsh-mini /v1/* 合同核心（EP-1 T-O-5）。
//
// 这一层只承载合同逻辑：worker 五端点委派（state/claim/alarm）、VFS、artifacts、
// SigV4 与 /a/{sha} 公网读面。测试/生产只差 entry（dev.mjs / server.mjs）与
// S3 endpoint/bucket/凭证/域名；本文件不含测试身份面、不读 admin 凭证。
//
// 面：
//   GET  /healthz
//   POST /v1/state/{get,put-cas} /v1/claim /v1/alarm/{due,claim}  —— worker 同码
//   POST /v1/vfs/{put,get,del,list}                              —— SigV4 直打 S3
//   POST /v1/artifacts/publish                                   —— content-hash 对象
//   GET  /a/{sha256}[.{ext}]
import { createRequire } from "node:module";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import worker from "../worker/worker.mjs";

const require = createRequire(import.meta.url);
const { verifyTicket } = require("../lib/ticket.cjs");

const VFS_MAX = 8 * 1024 * 1024;
const API_MAX_BODY = 16 * 1024 * 1024;

// ── 小工具 ────────────────────────────────────────────────────────────
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
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": b.byteLength,
    "access-control-allow-origin": "*",
  });
  res.end(b);
};

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const EXT_BY_MIME = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
  "application/json": ".json", "text/markdown": ".md", "text/plain": ".txt", "application/pdf": ".pdf",
};
const ARTIFACT_MIMES = new Set(Object.keys(EXT_BY_MIME));

export function createGateway(options) {
  const ticketSecret = options.ticketSecret;
  const s3 = options.s3;
  const publicBase = (options.publicBase ?? "").replace(/\/$/, "");
  const role = options.role ?? "durable";
  const log = options.log ?? ((...a) => console.log("[durable]", ...a));

  if (typeof ticketSecret !== "string" || ticketSecret === "") {
    throw new Error("TICKET_SECRET missing — refuse to start");
  }
  if (typeof s3?.endpoint !== "string" || s3.endpoint === ""
    || typeof s3?.bucket !== "string" || s3.bucket === ""
    || typeof s3?.accessKey !== "string" || s3.accessKey === ""
    || typeof s3?.secretKey !== "string" || s3.secretKey === "") {
    throw new Error("S3 credentials missing — refuse to start");
  }

  function ticketPayload(req, scope = "byok-proxy") {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return verifyTicket(ticketSecret, token, scope);
  }

  // ── SigV4（Node 侧，直打 S3/MinIO）──────────────────────────────────
  const hmac = (key, msg) => createHmac("sha256", key).update(msg).digest();
  const sha256 = (data) => createHash("sha256").update(data).digest();
  const uriEncode = (s, keepSlash = true) =>
    [...Buffer.from(s, "utf8")].map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/") ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }).join("");

  function canonicalQuery(params) {
    return Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null)
      .sort()
      .map((k) => `${uriEncode(k, false)}=${uriEncode(String(params[k]), false)}`)
      .join("&");
  }

  async function s3Request(method, key, opts = {}) {
    const host = new URL(s3.endpoint).host;
    const path = `/${s3.bucket}/${key}`;
    const now = new Date();
    const amz = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const date = amz.slice(0, 8);
    const body = opts.body === undefined ? Buffer.alloc(0) : Buffer.from(opts.body);
    const payloadHash = sha256(body).toString("hex");
    const headers = {
      host,
      "x-amz-date": amz,
      "x-amz-content-sha256": payloadHash,
      ...(opts.headers ?? {}),
    };
    const signed = Object.keys(headers).map((k) => k.toLowerCase()).sort();
    const canonHeaders = signed.map((k) => `${k}:${String(headers[k]).trim().replace(/\s+/g, " ")}\n`).join("");
    const canonUri = uriEncode(path);
    const query = opts.query === undefined ? "" : canonicalQuery(opts.query);
    const canonReq = [method, canonUri, query, canonHeaders, signed.join(";"), payloadHash].join("\n");
    const scope = `${date}/${s3.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha256(canonReq).toString("hex")].join("\n");
    let k = hmac(`AWS4${s3.secretKey}`, date);
    k = hmac(k, s3.region); k = hmac(k, "s3"); k = hmac(k, "aws4_request");
    const sig = hmac(k, toSign).toString("hex");
    const auth = `AWS4-HMAC-SHA256 Credential=${s3.accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}`;
    const url = `${s3.endpoint}${canonUri}${query ? `?${query}` : ""}`;
    const r = await fetch(url, {
      method,
      headers: { ...headers, authorization: auth },
      body: method === "GET" || method === "HEAD" ? undefined : body,
    });
    return r;
  }

  /** vfs 线键 `vfs/{rest}` → 全键 `dsh-mini/vfs/{openid}/{rest}`；同 worker rest 校验。 */
  const vfsFull = (key, openid) => {
    const m = typeof key === "string" && key.match(/^vfs\/(.+)$/);
    if (m === null || /(^|\/)\.\.(\/|$)|\/\/|^\/|(^|\/)dsh-mini(\/|$)/.test(m[1])) return null;
    return `dsh-mini/vfs/${openid}/${m[1]}`;
  };

  const xmlKeys = (xml) => [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const xmlTag = (xml, tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

  async function listAll(prefix, max = 1000) {
    const keys = [];
    let startAfter;
    for (;;) {
      const r = await s3Request("GET", "", {
        query: { "list-type": "2", prefix, "max-keys": String(max), "start-after": startAfter },
      });
      if (!r.ok) throw new Error(`s3 LIST ${prefix} → ${r.status}`);
      const xml = await r.text();
      keys.push(...xmlKeys(xml));
      if (xmlTag(xml, "IsTruncated") !== "true") break;
      startAfter = keys[keys.length - 1];
      if (startAfter === undefined) break;
    }
    return keys;
  }

  const workerEnv = () => ({
    S3_ENDPOINT: s3.endpoint,
    S3_BUCKET: s3.bucket,
    S3_REGION: s3.region,
    S3_ACCESS_KEY_ID: s3.accessKey,
    S3_SECRET_ACCESS_KEY: s3.secretKey,
    TICKET_SECRET: ticketSecret,
  });

  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
    const path = url.pathname;
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization, content-type, x-admin-token",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        });
        return res.end();
      }

      if (req.method === "GET" && path === "/healthz") {
        return json(res, 200, { ok: true, role, bucket: s3.bucket, endpoint: s3.endpoint, uptime_s: Math.floor(process.uptime()) });
      }

      // artifacts 公网读面：content-hash 寻址，不列举、不鉴权。
      if (req.method === "GET" && path.startsWith("/a/")) {
        const name = path.slice(3).split(".")[0];
        if (!/^[0-9a-f]{64}$/.test(name)) return json(res, 404, { error: "not-found" });
        const r = await s3Request("GET", `dsh-mini/artifacts-pub/${name}`);
        if (r.status === 404) return json(res, 404, { error: "not-found" });
        if (!r.ok) return json(res, 502, { error: `s3 ${r.status}` });
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, {
          "content-type": r.headers.get("content-type") ?? "application/octet-stream",
          "content-length": buf.byteLength,
          etag: r.headers.get("etag") ?? "",
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          "access-control-allow-origin": "*",
        });
        return res.end(buf);
      }

      const parseJson = async (max) => {
        const raw = (await readBody(req, max)).toString("utf8");
        try { return JSON.parse(raw || "{}"); } catch { return null; }
      };

      if (req.method === "POST" && path === "/v1/artifacts/publish") {
        const payload = ticketPayload(req);
        if (!payload?.oid) return json(res, 401, { error: "byok ticket required" });
        const j = await parseJson(VFS_MAX * 2);
        if (j === null) return json(res, 400, { error: "bad json" });
        const mime = typeof j.mime === "string" ? j.mime : "application/octet-stream";
        if (!ARTIFACT_MIMES.has(mime) && mime !== "application/octet-stream") {
          return json(res, 400, { error: "mime not allowed (executable/active content rejected)" });
        }
        const bytes = Buffer.from(String(j.bytes_b64 ?? ""), "base64");
        if (bytes.byteLength === 0 || bytes.byteLength > VFS_MAX) return json(res, 400, { error: "bytes_b64 required (≤8MB)" });
        const sha = sha256(bytes).toString("hex");
        const key = `dsh-mini/artifacts-pub/${sha}`;
        const put = await s3Request("PUT", key, { body: bytes, headers: { "content-type": mime } });
        if (!put.ok) return json(res, 502, { error: `s3 put ${put.status}` });
        const ext = EXT_BY_MIME[mime] ?? "";
        log(`artifacts/publish oid=${payload.oid} sha=${sha.slice(0, 12)} ${bytes.byteLength}B`);
        return json(res, 200, { sha256: sha, url: `${publicBase}/a/${sha}${ext}`, object_key: key });
      }

      if (req.method === "POST" && path.startsWith("/v1/vfs/")) {
        const payload = ticketPayload(req);
        if (!payload?.oid) return json(res, 401, { error: "byok ticket required" });
        const openid = payload.oid;
        const ep = path.slice("/v1/vfs/".length);
        const j = await parseJson(VFS_MAX * 2);
        if (j === null) return json(res, 400, { error: "bad json" });

        if (ep === "put") {
          const k = vfsFull(j.key, openid);
          if (k === null) return json(res, 400, { error: "bad key shape" });
          const bytes = Buffer.from(String(j.bytes_b64 ?? ""), "base64");
          if (bytes.byteLength > VFS_MAX) return json(res, 413, { error: "vfs body > 8MB" });
          if (typeof j.sha256 === "string" && j.sha256 !== sha256(bytes).toString("hex")) {
            return json(res, 400, { error: "sha256 mismatch" });
          }
          const headers = { "content-type": typeof j.mime === "string" ? j.mime : "application/octet-stream" };
          if (typeof j.if_match === "string") headers["if-match"] = `"${j.if_match.replace(/^"|"$/g, "")}"`;
          if (j.if_none_match === true) headers["if-none-match"] = "*";
          const r = await s3Request("PUT", k, { body: bytes, headers });
          if (r.status === 412) return json(res, 412, { error: "exists" });
          if (!r.ok) return json(res, 502, { error: `s3 put ${r.status}` });
          const etag = (r.headers.get("etag") ?? "").replace(/"/g, "");
          return json(res, 200, { etag, size: bytes.byteLength, object_key: k });
        }

        if (ep === "get") {
          const k = vfsFull(j.key, openid);
          if (k === null) return json(res, 400, { error: "bad key shape" });
          const offset = Math.max(0, Number(j.offset ?? 0));
          const maxBytes = typeof j.max_bytes === "number" ? Math.max(0, j.max_bytes) : undefined;
          const headers = {};
          if (offset > 0 || maxBytes !== undefined) {
            headers.range = `bytes=${offset}-${maxBytes !== undefined ? offset + maxBytes - 1 : ""}`;
          }
          const r = await s3Request("GET", k, { headers });
          if (r.status === 404) return json(res, 404, { error: "not-found" });
          if (!r.ok) return json(res, 502, { error: `s3 get ${r.status}` });
          const buf = Buffer.from(await r.arrayBuffer());
          const etag = (r.headers.get("etag") ?? "").replace(/"/g, "");
          let total = buf.byteLength;
          const cr = r.headers.get("content-range");
          if (cr !== null) {
            const m = cr.match(/\/(\d+)$/);
            if (m !== null) total = Number(m[1]);
          }
          return json(res, 200, {
            body_b64: buf.toString("base64"), etag, size: total,
            eof: offset + buf.byteLength >= total,
          });
        }

        if (ep === "del") {
          const k = vfsFull(j.key, openid);
          if (k === null) return json(res, 400, { error: "bad key shape" });
          const r = await s3Request("DELETE", k);
          if (!r.ok && r.status !== 404) return json(res, 502, { error: `s3 del ${r.status}` });
          return json(res, 200, { removed: r.status === 204 || r.status === 200 });
        }

        if (ep === "list") {
          const m = typeof j.prefix === "string" && j.prefix.match(/^vfs\/(.*)$/);
          if (m === null || /(^|\/)\.\.(\/|$)|\/\/|^\/|(^|\/)dsh-mini(\/|$)/.test(m[1])) return json(res, 400, { error: "bad prefix shape" });
          const limit = Math.min(Number(j.limit ?? 500), 1000);
          const fullPrefix = `dsh-mini/vfs/${openid}/${m[1]}`;
          const query = { "list-type": "2", prefix: fullPrefix, "max-keys": String(limit + 1) };
          if (typeof j.start_after === "string") {
            query["start-after"] = `dsh-mini/vfs/${openid}/${j.start_after.replace(/^vfs\//, "")}`;
          }
          const r = await s3Request("GET", "", { query });
          if (!r.ok) return json(res, 502, { error: `s3 list ${r.status}` });
          const xml = await r.text();
          const all = xmlKeys(xml);
          const truncated = all.length > limit || xmlTag(xml, "IsTruncated") === "true";
          const page = all.slice(0, limit);
          const keys = page.map((k) => `vfs/${k.slice(`dsh-mini/vfs/${openid}/`.length)}`);
          return json(res, 200, {
            keys, truncated,
            next_token: truncated ? keys[keys.length - 1] : undefined,
          });
        }

        return json(res, 404, { error: `no vfs route ${ep}` });
      }

      // worker 五端点委派：/v1/state/* /v1/claim /v1/alarm/*。
      if (req.method === "POST" && path.startsWith("/v1/")) {
        const body = await readBody(req, 1024 * 1024);
        const wr = new Request(`${publicBase}${path}`, {
          method: "POST",
          headers: {
            "content-type": req.headers["content-type"] ?? "application/json",
            authorization: req.headers.authorization ?? "",
          },
          body,
        });
        const wrres = await worker.fetch(wr, workerEnv());
        const text = await wrres.text();
        res.writeHead(wrres.status, {
          "content-type": wrres.headers.get("content-type") ?? "application/json",
          "access-control-allow-origin": "*",
        });
        return res.end(text);
      }

      return json(res, 404, { error: `no route ${path}` });
    } catch (e) {
      if (e?.message === "body-too-large") return json(res, 413, { error: "body too large" });
      log(`error ${path}:`, e.message, e?.cause?.code ?? e?.cause?.message ?? "");
      return json(res, 500, { error: String(e.message ?? e).slice(0, 200) });
    }
  };

  return { handler, listAll, healthz: () => ({ ok: true, role, bucket: s3.bucket, endpoint: s3.endpoint }) };
}

export { verifyTicket, timingSafeEqual, randomBytes, xmlEscape };
