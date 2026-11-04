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

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const WORKER = () => (process.env.DURABLE_WORKER_URL ?? "").replace(/\/$/, "");
const PROXY = () => (process.env.BYOK_PROXY_URL ?? "").replace(/\/$/, "");
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
      return r.status === 404 ? null : { body: r.body.body, etag: r.body.etag };
    },
    async putCas(key, body, cond) {
      if (body.length > 256 * 1024) return { status: 413 };
      const r = await call(openid, "state/put-cas", { key: wire(key), body, cond });
      return r.status === 200 ? { status: 200, etag: r.body.etag } : { status: 412 };
    },
    async listPrefix(p) {
      if (!/^dsh-mini\/alarms\/[^/]+\/?$/.test(p)) throw new Error(`listPrefix 收窄面仅 alarms: ${p}`);
      const r = await call(openid, "alarm/due", { now: Date.now() });
      return (r.body.keys ?? []).map(unwire);
    },
    async del(key) {
      // alarm 行：接 alarm/claim 原子消费（否则远端行永不消费）；claim 行靠 TTL 过期。
      const m = key.match(/^dsh-mini\/alarms\/[^/]+\/(.+)$/);
      if (m !== null) await call(openid, "alarm/claim", { key: m[1], holder: `sweeper-${Date.now()}` });
    },
  };
}

/** io.llm：经 BYOK proxy（票据注入，凭证只住 proxy 边界——与 mp io/llm.ts 同车道）。 */
function ioLlm(openid, model) {
  return async (messages) => {
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
function ioTool() {
  return async (name) => ({
    kind: "error",
    // kernel ErrorResultSchema 同构——error.code 必填（否则渲染层 TypeError 崩泵）
    error: { code: "tool-requires-local-vfs", message: `sweeper-side tool unavailable: ${name}（file_* 作用域在客户端 VFS）` },
    text: JSON.stringify({ error: "tool-requires-local-vfs", tool: name }),
    byte_length: 0,
    effect_state: "not-started",
    retryable: false,
    provenance: { context_layer: "transcript", context_role: "assistant", context_property: "tool-result" },
  });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

exports.main = async () => {
  if (WORKER() === "" || PROXY() === "" || TICKET_SECRET() === "") {
    console.log("sweeper: env 未配（DURABLE_WORKER_URL/BYOK_PROXY_URL/TICKET_SECRET）→ 空转");
    return { ok: false, reason: "env-missing" };
  }
  const { data: rows } = await db.collection("byok_keys").field({ openid: true, model: true }).get();
  const openids = [...new Set(rows.map((r) => r.openid).filter(Boolean))];
  const modelOf = Object.fromEntries(rows.map((r) => [r.openid, r.model]));
  const results = [];
  for (const openid of openids) {
    const ctx = {
      kernel: kernel.kernel ?? kernel,
      io: { llm: ioLlm(openid, modelOf[openid] ?? "unknown"), tool: ioTool(), state: ioState(openid) },
      owner: openid,
      holder: `sweeper-${Date.now()}`,
    };
    const ran = await host.sweepTick(ctx, { batchLimit: BATCH_LIMIT });
    results.push(...ran);
  }
  console.log(`sweeper tick: openids=${openids.length} ran=${JSON.stringify(results)}`);
  return { ok: true, ran: results };
};
