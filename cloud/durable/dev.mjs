// durable test entry（EP-1 T-O-5）—— 唯一持有测试身份面的入口。
//
// 与 server.mjs 同合同核心；额外挂 /dev/ticket、/dev/stats（ADMIN_TOKEN 闸）。
// 只服务 FRD1 / SSH 隧道；生产入口不 import 本文件。
//
// env：TICKET_SECRET ADMIN_TOKEN S3_ENDPOINT S3_BUCKET S3_REGION
//      S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY API_PORT API_BIND PUBLIC_BASE
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { createGateway } from "./core.mjs";

const require = createRequire(import.meta.url);
const { signTicket } = require("../lib/ticket.cjs");

const env = process.env;
const TICKET_SECRET = env.TICKET_SECRET ?? "";
const ADMIN_TOKEN = env.ADMIN_TOKEN ?? "";
const S3_ENDPOINT = (env.S3_ENDPOINT ?? "").replace(/\/$/, "");
const S3_BUCKET = env.S3_BUCKET ?? "";
const S3_REGION = env.S3_REGION ?? "us-east-1";
const ACCESS_KEY = env.S3_ACCESS_KEY_ID ?? "";
const SECRET_KEY = env.S3_SECRET_ACCESS_KEY ?? "";
const API_PORT = Number(env.API_PORT ?? 9095);
const API_BIND = env.API_BIND ?? "127.0.0.1";
const PUBLIC_BASE = (env.PUBLIC_BASE ?? `http://${API_BIND}:${API_PORT}`).replace(/\/$/, "");

const log = (...a) => console.log(`[test-s3 ${new Date().toISOString().slice(11, 19)}]`, ...a);

function refuse(reason) {
  console.error(`[test-s3] ${reason} — refuse to start`);
  process.exit(1);
}

if (TICKET_SECRET === "") refuse("TICKET_SECRET missing");
if (ADMIN_TOKEN === "") refuse("ADMIN_TOKEN missing");
if (S3_ENDPOINT === "" || S3_BUCKET === "") refuse("S3 endpoint/bucket missing");
if (ACCESS_KEY === "" || SECRET_KEY === "") refuse("S3 credentials missing");

let gateway;
try {
  gateway = createGateway({
    ticketSecret: TICKET_SECRET,
    s3: { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, region: S3_REGION, accessKey: ACCESS_KEY, secretKey: SECRET_KEY },
    publicBase: PUBLIC_BASE,
    role: "test-s3",
    log,
  });
} catch (e) {
  refuse(String(e?.message ?? e));
}

const json = (res, status, obj) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": b.byteLength,
    "access-control-allow-origin": "*",
  });
  res.end(b);
};

const readBody = (req, max = 4096) =>
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

function adminOk(req) {
  const tok = String(req.headers["x-admin-token"] ?? "");
  return ADMIN_TOKEN !== "" && tok.length === ADMIN_TOKEN.length
    && timingSafeEqual(Buffer.from(tok), Buffer.from(ADMIN_TOKEN));
}

async function devRoute(req, res, path) {
  if (!path.startsWith("/dev/")) return false;
  if (!adminOk(req)) { json(res, 403, { error: "admin token required" }); return true; }

  if (req.method === "POST" && path === "/dev/ticket") {
    let j;
    try { j = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}"); } catch { json(res, 400, { error: "bad json" }); return true; }
    if (typeof j.oid !== "string" || j.oid.length === 0) { json(res, 400, { error: "oid required" }); return true; }
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.min(Number(j.ttl_s ?? 1800), 90 * 86400);
    const ticket = signTicket(TICKET_SECRET, {
      oid: j.oid, scope: j.scope ?? "byok-proxy", jti: randomBytes(8).toString("base64url"),
      iat: now, exp: now + ttl,
    });
    json(res, 200, { ticket, exp: now + ttl });
    return true;
  }

  if (req.method === "GET" && path === "/dev/stats") {
    const keys = await gateway.listAll("dsh-mini/");
    const byPrefix = {};
    for (const k of keys) {
      const p = k.split("/").slice(0, 3).join("/");
      byPrefix[p] = (byPrefix[p] ?? 0) + 1;
    }
    json(res, 200, { ok: true, bucket: S3_BUCKET, objects: keys.length, by_prefix: byPrefix });
    return true;
  }

  json(res, 404, { error: `no dev route ${path}` });
  return true;
}

const apiServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
    if (await devRoute(req, res, url.pathname)) return;
    return gateway.handler(req, res);
  } catch (e) {
    if (e?.message === "body-too-large") return json(res, 413, { error: "body too large" });
    log("error:", e?.message ?? e);
    return json(res, 500, { error: String(e?.message ?? e).slice(0, 200) });
  }
});

apiServer.listen(API_PORT, API_BIND, () => {
  log(`api listening http://${API_BIND}:${API_PORT} bucket=${S3_BUCKET} s3=${S3_ENDPOINT}`);
});
