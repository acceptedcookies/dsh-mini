// sweeper —— cron 周期 tick（0/30s，config.json triggers）。
// T-O-7 形态：云函数宿主跑同一份 kernel 状态机（vendor/kernel.cjs）+ 产品化泵
// （vendor/host.cjs = services/nano-mini-host/pump.ts 的 esbuild 出口，与 mp 同源）。
// 流程：枚举 byok_keys openid → 每 openid 自签 BYOK 票据 → worker /v1/alarm/due
// → alarm/claim → runPump（io.state=worker 五端点 / io.llm=BYOK proxy / io.tool 见下注）。
// secrets（env-only）：TICKET_SECRET、DURABLE_WORKER_URL、BYOK_PROXY_URL。
const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");
const kernel = require("./vendor/kernel.cjs");
const host = require("./vendor/host.cjs");

// TEST-ONLY: WeChat cloud may create new functions on Nodejs16.13 (no global fetch).
const http = require("node:http");
const https = require("node:https");
function nodeFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: opts.method ?? "GET", headers: opts.headers ?? {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          text: async () => buf.toString("utf8"),
          json: async () => JSON.parse(buf.toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
if (typeof globalThis.fetch !== "function") globalThis.fetch = nodeFetch;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 公网端点内嵌默认值（非密钥——密钥仅 TICKET_SECRET 必须 env）；
// FRD1 durable 生产面 = worker 五端点同码；旧 POD1 fss3 已退役。
const WORKER = () => (process.env.DURABLE_WORKER_URL ?? "https://dsh-mini-test.saobao.com").replace(/\/$/, "");
const PROXY = () => (process.env.BYOK_PROXY_URL ?? "https://dsh-byok-proxy-341346-12-1326709251.sh.run.tcloudbase.com").replace(/\/$/, "");
const TICKET_SECRET = () => process.env.TICKET_SECRET ?? "";
const BATCH_LIMIT = 10;

function signTicket(secret, claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(claims);
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const mint = (openid) =>
  signTicket(TICKET_SECRET(), { oid: openid, scope: "byok-proxy", jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120 });

async function call(openid, ep, payload) {
  const r = await fetch(`${WORKER()}/v1/${ep}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${mint(openid)}` },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** remote CAS（worker 五端点）：与 services/state/remote-cas.ts 同线格式 {kind}/{rest}。 */
function ioState(openid) {
  const wire = (full) => {
    const m = full.match(/^dsh-mini\/(state|claims|alarms)\/[^/]+\/(.+)$/);
    return m !== null ? `${m[1]}/${m[2]}` : full.replace(/^dsh-mini\//, "");
  };
  const unwire = (w) => {
    const m = w.match(/^(state|claims|alarms)\/(.+)$/);
    return m !== null ? `dsh-mini/${m[1]}/${openid}/${m[2]}` : w;
  };
  return {
    async get(key) {
      const r = await call(openid, "state/get", { key: wire(key) });
      // 与 services/state/remote-cas.ts 同语义：仅 404 是 miss，其余非 2xx 如实抛——不伪装 miss/空。
      if (r.status === 404) return null;
      if (r.status !== 200) throw new Error(`state/get ${wire(key)} → ${r.status}`);
      return { body: r.body.body, etag: r.body.etag };
    },
    async putCas(key, body, cond) {
      if (body.length > 256 * 1024) return { status: 413 };
      const r = await call(openid, "state/put-cas", { key: wire(key), body, cond });
      if (r.status === 200) return { status: 200, etag: r.body.etag };
      if (r.status === 412) return { status: 412 };
      throw new Error(`state/put-cas ${wire(key)} → ${r.status}`);
    },
    async listPrefix(p) {
      if (!/^dsh-mini\/alarms\/[^/]+\/?$/.test(p)) throw new Error(`listPrefix 收窄面仅 alarms: ${p}`);
      const r = await call(openid, "alarm/due", { now: Date.now() });
      // 枚举失败必须抛——返回 [] 会让后端故障伪装成「无 due」静默丢闹钟。
      if (r.status !== 200) throw new Error(`alarm/due → ${r.status}`);
      return (r.body.keys ?? []).map(unwire);
    },
    async del(key) {
      // alarm 行：接 alarm/claim 原子消费（否则远端行永不消费）；claim 行靠 TTL 过期。
      const m = key.match(/^dsh-mini\/alarms\/[^/]+\/(.+)$/);
      if (m === null) return;
      const r = await call(openid, "alarm/claim", { key: m[1], holder: `sweeper-${Date.now()}` });
      // 404 = 已被并发消费者取走（at-least-once 容忍）；其余失败如实抛——不静默漏消费。
      if (r.status !== 200 && r.status !== 404) throw new Error(`alarm/claim ${m[1]} → ${r.status}`);
    },
  };
}

/** io.llm：经 BYOK proxy（票据注入，凭证只住 proxy 边界——与 mp io/llm.ts 同车道）。 */
function ioLlm(openid, model) {
  return async (messages) => {
    if (process.env.SIM_WX_ALARM_TEST === "1") {
      // TEST-ONLY: deterministic final answer; no production proxy call.
      return { text: "sim-final", usage: { inputTokens: 0, outputTokens: 0 } };
    }
    const r = await fetch(`${PROXY()}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${mint(openid)}` },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    if (r.status !== 200) throw new Error(`proxy llm ${r.status}`);
    const b = await r.json();
    const msg = b.choices?.[0]?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, input: safeParse(tc.function.arguments) }));
    return { text: msg.content ?? null, toolCalls: toolCalls.length ? toolCalls : undefined, usage: b.usage };
  };
}

/**
 * io.tool（sweeper 侧）：file_* 作用域在 mp VFS（本地对象），sweeper 侧不可达。
 * 返回 honest error 结果——kernel 记为 tool error（非伪造执行），
 * turn 在下一 llm 步由模型处置；前台 mp tick 恢复后可继续跑真工具。
 */
function ioTool(openid) {
  return async (name, input) => {
    if (name === "sim_echo") {
      const args = (input && typeof input === "object") ? input : {};
      const counterKey = typeof args.counter_key === "string" && args.counter_key.length > 0
        ? args.counter_key
        : "state/sim-tool-count";
      const cur = await call(openid, "state/get", { key: counterKey });
      const count = cur.status === 200 ? Number(JSON.parse(cur.body.body).count ?? 0) : 0;
      const next = count + 1;
      const wr = await call(openid, "state/put-cas", {
        key: counterKey,
        body: JSON.stringify({ count: next, at: Date.now() }),
        cond: cur.status === 200 ? { ifMatch: cur.body.etag } : { ifNoneMatch: "*" },
      });
      if (wr.status !== 200) {
        return {
          kind: "error",
          error: { code: "sim-echo-counter-failed", message: `counter put ${wr.status}` },
          text: JSON.stringify({ error: "sim-echo-counter-failed", status: wr.status }),
          byte_length: 0,
          effect_state: "not-started",
          retryable: true,
          provenance: { context_layer: "transcript", context_role: "assistant", context_property: "tool-result" },
        };
      }
      const text = JSON.stringify({ echo: "sim", count: next });
      return {
        kind: "inline-text",
        text,
        byte_length: text.length,
        provenance: { context_layer: "transcript", context_role: "assistant", context_property: "tool-result" },
      };
    }
    return {
      kind: "error",
      error: { code: "tool-requires-local-vfs", message: `sweeper-side tool unavailable: ${name}（file_* 作用域在客户端 VFS）` },
      text: JSON.stringify({ error: "tool-requires-local-vfs", tool: name }),
      byte_length: 0,
      effect_state: "not-started",
      retryable: false,
      provenance: { context_layer: "transcript", context_role: "assistant", context_property: "tool-result" },
    };
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

exports.main = async () => {
  if (TICKET_SECRET() === "") {
    console.log("sweeper: TICKET_SECRET env 未配 → 空转");
    return { ok: false, reason: "env-missing" };
  }
  const { data: rows } = await db.collection("byok_keys").field({ openid: true, model: true }).get();
  const openids = [...new Set(rows.map((r) => r.openid).filter(Boolean))];
  const modelOf = Object.fromEntries(rows.map((r) => [r.openid, r.model]));
  const results = [];
  for (const openid of openids) {
    const ctx = {
      kernel: kernel.kernel ?? kernel,
      io: { llm: ioLlm(openid, modelOf[openid] ?? "unknown"), tool: ioTool(openid), state: ioState(openid) },
      owner: openid,
      holder: `sweeper-${Date.now()}`,
    };
    const ran = await host.sweepTick(ctx, { batchLimit: BATCH_LIMIT });
    results.push(...ran);
  }
  console.log(`sweeper tick: openids=${openids.length} ran=${JSON.stringify(results)}`);
  return { ok: true, ran: results };
};
