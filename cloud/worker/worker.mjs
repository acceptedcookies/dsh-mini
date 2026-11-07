// dsh-mini durable worker —— 五端点收窄面（T-O-5），pgs3/S3 后端。
// POST /v1/state/get      {key:"{kind}/{rest}"}           → {body,etag} | 404
// POST /v1/state/put-cas  {key,body,cond:{ifMatch|ifNoneMatch:'*'}} → {etag} | 412
// POST /v1/claim          {key:"{sid}",holder,ttlMs}      → {holder} | 412
// POST /v1/alarm/due      {now?}                          → {keys:["alarms/{rest}",...]}
// POST /v1/alarm/claim    {key:"{rest}",holder}           → {body} | 404
//
// openid 服务端注入：Bearer BYOK 票据（unlock 签发，TICKET_SECRET 校验）→ payload.oid。
// 客户端 body 内任何 openid 字段被忽略（永不读）。
// S3 走 SigV4（env: S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY）；
// CAS 语义：pgs3 原生 If-Match/If-None-Match；泛 S3 退化 ETag 比对（MinIO 语义待 T10 授权探测）。
// 限制：单 body ≤ 256KB；alarms 列举按用户前缀收窄。

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(u8) {
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof msg === "string" ? enc.encode(msg) : msg));
}
async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
}

/** BYOK 票据校验（与 cloud/lib/ticket.cjs 同规格，WebCrypto 版）。 */
async function verifyTicket(secret, token, scope) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expect = b64url(await hmac(secret, `${parts[0]}.${parts[1]}`));
  if (expect !== parts[2]) return null;
  let payload;
  try { payload = JSON.parse(dec.decode(unb64url(parts[1]))); } catch { return null; }
  if (payload.exp === undefined || Date.now() / 1000 >= payload.exp) return null;
  if (scope !== undefined && payload.scope !== scope) return null;
  return payload;
}

// ── SigV4 ────────────────────────────────────────────────────────────
function uriEncode(s, keepSlash = true) {
  return [...enc.encode(s)].map((b) => {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) return c;
    return `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

async function sigv4(env, method, key, opts = {}) {
  const host = new URL(env.S3_ENDPOINT).host;
  const path = `/${env.S3_BUCKET}/${key}`;
  const now = new Date();
  const amz = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const date = amz.slice(0, 8);
  const headers = { host, "x-amz-date": amz, "x-amz-content-sha256": opts.payloadHash ?? (opts.body === undefined ? hex(await sha256("")) : hex(await sha256(opts.body))) };
  if (opts.ifMatch !== undefined) headers["if-match"] = opts.ifMatch;
  if (opts.ifNoneMatch !== undefined) headers["if-none-match"] = opts.ifNoneMatch;
  if (opts.body !== undefined) headers["content-type"] = "application/octet-stream";
  const signed = Object.keys(headers).sort();
  const canonHeaders = signed.map((k) => `${k}:${headers[k]}\n`).join("");
  const canonReq = [method, uriEncode(path), opts.query ?? "", canonHeaders, signed.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${date}/${env.S3_REGION ?? "us-east-1"}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, hex(await sha256(canonReq))].join("\n");
  let k = await hmac(`AWS4${env.S3_SECRET_ACCESS_KEY}`, date);
  k = await hmac(k, env.S3_REGION ?? "us-east-1");
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  const sig = hex(await hmac(k, toSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}`;
  return { url: `${env.S3_ENDPOINT.replace(/\/$/, "")}${uriEncode(path)}${opts.query ? `?${opts.query}` : ""}`, headers: { ...headers, authorization: auth } };
}

async function s3(env, method, key, opts = {}) {
  const req = await sigv4(env, method, key, opts);
  return fetch(req.url, { method, headers: req.headers, body: opts.body });
}

// ── durable 行操作 ───────────────────────────────────────────────────
async function casGet(env, fullKey) {
  const r = await s3(env, "GET", fullKey);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`s3 GET ${fullKey} → ${r.status}`);
  return { body: await r.text(), etag: (r.headers.get("etag") ?? "").replace(/"/g, "") };
}
async function casPut(env, fullKey, body, cond = {}) {
  const opts = { body };
  if (cond.ifMatch !== undefined) opts.ifMatch = `"${cond.ifMatch}"`;
  if (cond.ifNoneMatch === "*") opts.ifNoneMatch = "*";
  const r = await s3(env, "PUT", fullKey, opts);
  if (r.status === 412) return { status: 412 };
  // 非 200/412 不得伪装成 etag-conflict——后端故障透传真实状态（审查修复）
  if (!r.ok) return { status: r.status, backendError: true };
  const etag = (r.headers.get("etag") ?? "").replace(/"/g, "");
  return { status: 200, etag };
}
async function casDel(env, fullKey, cond = {}) {
  const opts = {};
  if (cond.ifMatch !== undefined) opts.ifMatch = `"${cond.ifMatch}"`;
  return s3(env, "DELETE", fullKey, opts);
}
async function listKeys(env, prefix) {
  const keys = [];
  let token;
  do {
    let q = `list-type=2&prefix=${uriEncode(prefix, false)}`;
    if (token !== undefined) q += `&continuation-token=${uriEncode(token, false)}`;
    const r = await s3(env, "GET", "", { query: q });
    if (!r.ok) throw new Error(`s3 LIST ${prefix} → ${r.status}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null)
      : undefined;
    if (token === null) throw new Error("s3 LIST truncated without continuation token");
  } while (token !== undefined);
  return keys;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const MAX_BODY = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.startsWith("/v1/")) return json({ error: "no route" }, 404);
    // fail-closed：secret 缺位时 HMAC("") 仍可验出「合法」票据——宁可 500 不可放行。
    if (typeof env.TICKET_SECRET !== "string" || env.TICKET_SECRET === "") return json({ error: "server misconfig: TICKET_SECRET missing" }, 500);
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const payload = await verifyTicket(env.TICKET_SECRET, token, "byok-proxy");
    if (!payload?.oid) return json({ error: "byok ticket required" }, 401);
    const openid = payload.oid; // 服务端注入——body 内 openid 字段永不读
    let j;
    try { j = await request.json(); } catch { return json({ error: "bad json" }, 400); }

    /** 线键 `{kind}/{rest}` → 全键 `dsh-mini/{kind}/{openid}/{rest}`；openid 注入。 */
    const full = (key) => {
      const m = typeof key === "string" && key.match(/^(state|claims|alarms|probe)\/(.+)$/);
      // rest 段拒 `..`/`//`/前导 `/`——对会做路径归一化的后端防穿越（审查 P2）；
      // 'dsh-mini' 按段锚定——子串拒会误伤合法文件名（审查 B8）
      if (m === null || /(^|\/)\.\.(\/|$)|\/\/|^\/|(^|\/)dsh-mini(\/|$)/.test(m[2])) return null;
      return `dsh-mini/${m[1]}/${openid}/${m[2]}`;
    };
    const ep = url.pathname.slice("/v1/".length);
    try {
      if (ep === "state/get") {
        const k = full(j.key);
        if (k === null) return json({ error: "bad key shape" }, 400);
        const r = await casGet(env, k);
        return r === null ? json({ error: "not-found" }, 404) : json({ body: r.body, etag: r.etag });
      }
      if (ep === "state/put-cas") {
        const k = full(j.key);
        if (k === null) return json({ error: "bad key shape" }, 400);
        const body = String(j.body ?? "");
        if (body.length > MAX_BODY) return json({ error: "state body > 256KB" }, 413);
        const r = await casPut(env, k, body, j.cond ?? {});
        if (r.backendError === true) return json({ error: `backend ${r.status}` }, r.status);
        return r.status === 200 ? json({ etag: r.etag }) : json({ error: "etag-conflict" }, 412);
      }
      if (ep === "claim") {
        const k = full(`claims/${j.key}`);
        if (k === null) return json({ error: "bad key shape" }, 400);
        const cur = await casGet(env, k);
        if (cur !== null) {
          try {
            const c = JSON.parse(cur.body);
            if (c.holder !== j.holder && Date.parse(c.expires) > Date.now()) {
              return json({ error: "claim-held", holder: c.holder }, 412);
            }
          } catch { /* 坏行可覆盖 */ }
        }
        // ttlMs 钳制 [0,1h]：无界值是 self-DoS 面（oid 虽服务端注入，键区仍共享）。
        const ttlMs = Math.min(Math.max(Number(j.ttlMs ?? 30000) || 0, 0), 3600000);
        const rec = { holder: j.holder, expires: new Date(Date.now() + ttlMs).toISOString() };
        const r = await casPut(env, k, JSON.stringify(rec), cur !== null ? { ifMatch: cur.etag } : { ifNoneMatch: "*" });
        if (r.backendError === true) return json({ error: `backend ${r.status}` }, r.status);
        return r.status === 200 ? json({ holder: j.holder }) : json({ error: "claim-held" }, 412);
      }
      if (ep === "alarm/due") {
        const prefix = `dsh-mini/alarms/${openid}/`;
        const now = j.now ?? Date.now();
        const keys = [];
        // dueTs 已编码在键名 {dueTs}-{sid} 内——按键名过滤零读放大（审查修复：原逐行 GET）
        for (const k of await listKeys(env, prefix)) {
          const rest = k.slice(prefix.length);
          const dueTs = Number(rest.split("-")[0]);
          if (Number.isFinite(dueTs) && dueTs <= now) keys.push(`alarms/${rest}`);
        }
        return json({ keys });
      }
      if (ep === "alarm/claim") {
        const k = full(`alarms/${j.key}`);
        if (k === null) return json({ error: "bad key shape" }, 400);
        const row = await casGet(env, k);
        if (row === null) return json({ error: "not-found" }, 404);
        // 条件删兑现原子消费：并发 claimer 只有一个拿到 200，其余 412→404（已被消费）。
        const d = await casDel(env, k, { ifMatch: row.etag });
        if (d.status === 412 || d.status === 404) return json({ error: "already-claimed" }, 404);
        if (!d.ok) return json({ error: `backend ${d.status}` }, d.status);
        return json({ body: row.body });
      }
      return json({ error: `no route ${ep}` }, 404);
    } catch (e) {
      return json({ error: String(e.message ?? e) }, 500);
    }
  },
};
