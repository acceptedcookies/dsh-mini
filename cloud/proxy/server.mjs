// 数据面 CloudBase Run 服务：验票据 → 取 per-openid 记录 → 内存解密 → 转发上游 → SSE 流回。
// 与 sim 同构（cloud/sim/server.mjs 的 /v1/* 段即本文件的镜像）；差异：
//   - openid 取票据 oid（控制面签发时已绑真实 openid）
//   - 记录源 = 云数据库 byok_keys（@cloudbase/node-sdk）
//   - 吊销检查 = byok_revoked 集合查 jti
// env: PORT(平台注入), MASTER_KEY, TICKET_SECRET, TCB_ENV
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
// 双布局兼容：仓库内 ../lib = cloud/lib（canonical）；部署 zip 内 ./lib = 容器根同级。
const lib = (p) => {
  try { return require(`../lib/${p}`) } catch { return require(`./lib/${p}`) }
};
const { decryptKey } = lib("envelope.cjs");
const { verifyTicket } = lib("ticket.cjs");

const PORT = Number(process.env.PORT ?? 8080);
const MASTER_KEY = process.env.MASTER_KEY;
const TICKET_SECRET = process.env.TICKET_SECRET;
// 业主裁决的支持模型白名单（逗号分隔；空=不限）。与 sim SIM_ALLOWED_MODELS 口径一致。
const ALLOWED_MODELS = (process.env.ALLOWED_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!MASTER_KEY || !TICKET_SECRET) throw new Error("MASTER_KEY/TICKET_SECRET required");

// wx-server-sdk 与云函数同构（微信侧 SDK 识别云托管注入凭证）；本地 sim 不走此文件。
// env 用 DYNAMIC_CURRENT_ENV 自动探测容器所在环境——显式写死异 env 或 SDK 不认
// 注入面都会触发 "missing secretId or secretKey"。
const cloud = require("wx-server-sdk");
const dbEnv = process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV;
cloud.init({ env: dbEnv });
const db = cloud.database();
console.log(`[proxy] tcb env: ${process.env.TCB_ENV ?? "(current)"}`);
const _ = db.command;

const log = (...a) => console.log(`[proxy ${new Date().toISOString().slice(11, 19)}]`, ...a);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function findRecord(openid, provider) {
  const q = provider ? { openid, provider } : { openid };
  const r = await db.collection("byok_keys").where(q).limit(1).get();
  return r.data[0];
}

async function isRevoked(jti) {
  const r = await db.collection("byok_revoked").where({ jti }).limit(1).get();
  return r.data.length > 0;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (path === "/health") return json(res, 200, { ok: true });
    if (!path.startsWith("/v1/")) return json(res, 404, { error: `no route ${path}` });

    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const payload = verifyTicket(TICKET_SECRET, token, "byok-proxy");
    if (!payload) return json(res, 401, { error: "byok ticket required" });
    if (await isRevoked(payload.jti)) return json(res, 401, { error: "ticket revoked" });
    const rec = await findRecord(payload.oid, req.headers["x-byok-provider"]);
    if (!rec) return json(res, 404, { error: "no enrolled record for openid" });
    const apiKey = decryptKey(MASTER_KEY, rec.ciphertext, rec.recordId, rec.openid, rec.provider);
    const upstream = `${rec.base_url}${path.slice(3)}`;
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    // 数据面模型闸：body.model 须在白名单内
    if (body !== undefined && ALLOWED_MODELS.length > 0) {
      let m;
      try {
        m = JSON.parse(body.toString("utf8")).model;
      } catch {
        m = undefined;
      }
      if (typeof m === "string" && !ALLOWED_MODELS.includes(m)) {
        return json(res, 403, { error: `model not allowed: ${m}`, allowed_models: ALLOWED_MODELS });
      }
    }
    log(`proxy ${req.method} ${path} → ${upstream} (oid=${payload.oid})`);
    const up = await fetch(upstream, { method: req.method, headers, body });
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/octet-stream" });
    const reader = up.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    log(`error ${path}:`, e.message);
    if (!res.headersSent) json(res, 500, { error: String(e.message) });
    else res.end();
  }
});

server.listen(PORT, () => log(`byok proxy listening :${PORT}`));
