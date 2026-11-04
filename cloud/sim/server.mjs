// 本地模拟微信云端 —— 控制面(bio/challenge/enroll/unlock/revoke) + 数据面(/v1/* SSE proxy)。
// 与真云同构：同一 envelope/ticket canonical 规格 + bio 证明验签（sim=HMAC 证明，真云=soter.verifySignature）。
// 差异仅在 openid 来源（sim 固定 dev 用户）与 bio 证明签发方（sim 自签，真云=TEE）。
// dev 专用端点以 _ 前缀标记（POST /sim/_bio 门禁开关、POST /sim/_reset 清库）。
// 用法: node cloud/sim/server.mjs   监听 127.0.0.1:3426，记录持久化 os.tmpdir()/dsh-cloud-sim-db.json
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { encryptKey, decryptKey } = require("../lib/envelope.cjs");
const { signTicket, verifyTicket } = require("../lib/ticket.cjs");

const here = dirname(fileURLToPath(import.meta.url));
// 存放于 os.tmpdir：写库不得落项目目录内——DevTools 文件监听会把写库当成代码变更触发重编译，
// 直接杀死在途 turn（实测复现）。
const DB_PATH = join(tmpdir(), "dsh-cloud-sim-db.json");
const PORT = Number(process.env.SIM_PORT ?? 3426);
// dev 面常量：本地 sim 的唯一租户与密钥——非生产凭证，仅约束 sim 内部一致性。
const SIM_OPENID = "sim_dev_user";
const SIM_MASTER_KEY = "sim-master-key-dev";
const SIM_TICKET_SECRET = "sim-ticket-secret-dev";
const SIM_BIO_SECRET = "sim-bio-secret-dev";
const TICKET_TTL_S = 1800; // 30min
const CHALLENGE_TTL_MS = 120000;
// 业主裁决的支持模型白名单：与 .local.development.json allowed_models 口径一致，env 可覆写。
const ALLOWED_MODELS = (process.env.SIM_ALLOWED_MODELS ?? "workbuddy/deepseek-v4.1-flash,workbuddy/deepseek-v4-pro").split(",").map((s) => s.trim()).filter(Boolean);

const defaults = { records: [], blacklist: [], challenges: {}, bio: { supported: true, enrolled: true }, bioCounter: 0 };
const db = existsSync(DB_PATH) ? { ...defaults, ...JSON.parse(readFileSync(DB_PATH, "utf8")) } : defaults;
const persist = () => writeFileSync(DB_PATH, JSON.stringify(db, null, 1));

const log = (...a) => console.log(`[sim ${new Date().toISOString().slice(11, 19)}]`, ...a);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "content-type": "application/json" });
  res.end(b);
}

function recordFor(openid, provider) {
  return db.records.find((r) => r.openid === openid && (provider === undefined || r.provider === provider));
}

function hmac(secret, data) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function challengeState(challenge) {
  const ch = db.challenges[challenge];
  if (!ch || ch.used || ch.exp < Date.now()) return null;
  return ch;
}

/**
 * 验证 bio 证明（对齐真云 soter.verifySignature 语义）：
 * 签名 = HMAC(bio_secret, result_json)；result_json.raw 必须等于 challenge。
 * 成功则消费 challenge（一次性）。
 */
function verifyBioProof({ challenge, result_json, result_signature }) {
  const ch = challengeState(challenge);
  if (!ch) return { error: "challenge invalid/expired/used" };
  if (typeof result_json !== "string" || typeof result_signature !== "string") return { error: "bio proof required" };
  const expect = hmac(SIM_BIO_SECRET, result_json);
  if (expect.length !== result_signature.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(result_signature))) {
    return { error: "bio signature mismatch" };
  }
  let raw;
  try {
    raw = JSON.parse(result_json).raw;
  } catch {
    return { error: "result_json malformed" };
  }
  if (raw !== challenge) return { error: "challenge mismatch" };
  ch.used = true;
  return { ok: true };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    // ---------- 控制面 ----------
    if (req.method === "POST" && path === "/sim/challenge") {
      const challenge = randomBytes(16).toString("base64url");
      db.challenges[challenge] = { openid: SIM_OPENID, exp: Date.now() + CHALLENGE_TTL_MS, used: false };
      persist();
      return json(res, 200, { openid: SIM_OPENID, challenge, expires_at: db.challenges[challenge].exp });
    }

    // bio 能力查询（对齐 wx.checkIsSupportSoterAuthentication + checkIsSoterEnrolledInDevice）
    if (req.method === "GET" && path === "/sim/bio") {
      return json(res, 200, { supported: db.bio.supported, enrolled: db.bio.enrolled });
    }

    // bio 证明签发（对齐 wx.startSoterAuthentication：challenge → TEE 签名；sim 为 HMAC 自签）
    if (req.method === "POST" && path === "/sim/bio") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!db.bio.supported || !db.bio.enrolled) return json(res, 403, { error: "bio unavailable (SIM_BIO off)" });
      if (!challengeState(body.challenge)) return json(res, 401, { error: "challenge invalid/expired/used" });
      db.bioCounter += 1;
      const resultJSON = JSON.stringify({ raw: body.challenge, counter: db.bioCounter, uid: "sim-tee", openid: SIM_OPENID });
      persist();
      return json(res, 200, { result_json: resultJSON, result_signature: hmac(SIM_BIO_SECRET, resultJSON) });
    }

    if (req.method === "POST" && path === "/sim/enroll") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const { provider = "magpie", base_url, api_key = "", model } = body;
      if (!base_url) return json(res, 400, { error: "base_url required" });
      if (model !== undefined && !ALLOWED_MODELS.includes(model)) {
        return json(res, 403, { error: `model not allowed: ${model}`, allowed_models: ALLOWED_MODELS });
      }
      // 业主裁决：无 bio 禁止注入 —— 服务端强制验签（客户端门禁仅为 UX）
      const v = verifyBioProof(body);
      if (v.error) return json(res, 401, v);
      const recordId = randomBytes(8).toString("base64url");
      const ciphertext = encryptKey(SIM_MASTER_KEY, recordId, SIM_OPENID, provider, api_key);
      const rec = { recordId, openid: SIM_OPENID, provider, base_url, model: model ?? null, ciphertext, key_version: 1, created_at: Date.now() };
      db.records = db.records.filter((r) => !(r.openid === SIM_OPENID && r.provider === provider));
      db.records.push(rec);
      persist();
      log(`enroll: provider=${provider} base_url=${base_url} model=${model ?? "-"} (key ${api_key ? "set" : "empty"})`);
      return json(res, 200, { ok: true, provider });
    }

    if (req.method === "POST" && path === "/sim/unlock") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      // 真云此处走 soter.verifySignature；sim 为同构 HMAC 证明（SIM_BIO=off 时 /sim/bio 已拒签）
      const v = verifyBioProof(body);
      if (v.error) return json(res, 401, v);
      const ticket = signTicket(SIM_TICKET_SECRET, {
        oid: SIM_OPENID,
        scope: "byok-proxy",
        jti: randomBytes(8).toString("base64url"),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + TICKET_TTL_S,
      });
      persist();
      log(`unlock → ticket issued (oid=${SIM_OPENID})`);
      return json(res, 200, { ticket, exp: Math.floor(Date.now() / 1000) + TICKET_TTL_S });
    }

    if (req.method === "POST" && path === "/sim/revoke") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (body.action === "key") {
        db.records = db.records.filter((r) => !(r.openid === SIM_OPENID && r.provider === body.provider));
        persist();
        log(`revoke key: provider=${body.provider}`);
        return json(res, 200, { ok: true });
      }
      const payload = verifyTicket(SIM_TICKET_SECRET, body.ticket, "byok-proxy");
      if (!payload) return json(res, 401, { error: "invalid ticket" });
      db.blacklist.push(payload.jti);
      persist();
      return json(res, 200, { ok: true });
    }

    // ---------- dev 专用（_ 前缀：非真云同构面） ----------
    if (req.method === "POST" && path === "/sim/_bio") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      db.bio = { supported: body.supported !== false, enrolled: body.enrolled !== false };
      persist();
      log(`bio toggled: supported=${db.bio.supported} enrolled=${db.bio.enrolled}`);
      return json(res, 200, db.bio);
    }

    if (req.method === "POST" && path === "/sim/_reset") {
      db.records = [];
      db.challenges = {};
      persist();
      log(`reset: records+challenges cleared`);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/sim/status") {
      return json(res, 200, {
        openid: SIM_OPENID,
        bio: db.bio,
        allowed_models: ALLOWED_MODELS,
        records: db.records.map(({ ciphertext: _c, ...r }) => r),
      });
    }

    // ---------- 数据面 ----------
    if (path.startsWith("/v1/")) {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const payload = verifyTicket(SIM_TICKET_SECRET, token, "byok-proxy");
      if (!payload) return json(res, 401, { error: "byok ticket required" });
      if (db.blacklist.includes(payload.jti)) return json(res, 401, { error: "ticket revoked" });
      const rec = recordFor(payload.oid, req.headers["x-byok-provider"]);
      if (!rec) return json(res, 404, { error: "no enrolled record for openid" });
      const rawBody = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      // 数据面模型闸：body.model 须在白名单内（业主裁决仅两款 DeepSeek）
      if (rawBody !== undefined) {
        let m;
        try {
          m = JSON.parse(rawBody.toString("utf8")).model;
        } catch {
          m = undefined;
        }
        if (typeof m === "string" && !ALLOWED_MODELS.includes(m)) {
          return json(res, 403, { error: `model not allowed: ${m}`, allowed_models: ALLOWED_MODELS });
        }
      }
      const apiKey = decryptKey(SIM_MASTER_KEY, rec.ciphertext, rec.recordId, rec.openid, rec.provider);
      const upstream = `${rec.base_url}${path.slice(3)}`; // /v1/x → base_url + /x? base_url 已含 /v1
      const headers = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      log(`proxy ${req.method} ${path} → ${upstream} (oid=${payload.oid}, key=${apiKey ? "key" : "none"})`);
      const up = await fetch(upstream, { method: req.method, headers, body: rawBody });
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/octet-stream" });
      const reader = up.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    if (path === "/health") return json(res, 200, { ok: true, mode: "sim", records: db.records.length });
    return json(res, 404, { error: `no route ${path}` });
  } catch (e) {
    log(`error ${path}:`, e.message);
    if (!res.headersSent) json(res, 500, { error: String(e.message) });
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log(`cloud-sim listening http://127.0.0.1:${PORT}`);
  log(`control: POST /sim/{challenge,bio,enroll,unlock,revoke} GET /sim/{bio,status}  data: /v1/* (Bearer ticket)`);
  log(`allowed_models: ${ALLOWED_MODELS.join(", ")}`);
});
