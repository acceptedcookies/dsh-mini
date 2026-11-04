// ST-H4 — magpie 本机 live 端点实测 (V-T6)
// 业主 2026-11-03 授权：以 .local.development.json 登记的 magpie 网关
// (api_type=responses) 做真实 Responses API 探针——非流式 / tool call / SSE 流式。
// 这是 live-local 证据: 经真实网关与真实模型路由, 不是 mock; 但不等于
// 任意公网 provider 的证据 (envClass 记 host-local-live)。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TOOL = {
  type: "function",
  name: "get_weather",
  description: "Get current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

async function postResponses(baseUrl, body, { stream = false, timeoutMs = 45_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream }),
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function sseEvents(text) {
  // Parse "event: X\ndata: Y" blocks; return [{event, data}].
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = null;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event || data) out.push({ event, data });
  }
  return out;
}

export async function run(ctx) {
  const { spikeDir } = ctx;
  const cfgPath = join(spikeDir, "..", "..", "..", ".local.development.json");
  if (!existsSync(cfgPath)) {
    return {
      verdict: "NOT_RUN",
      reason: ".local.development.json absent — live endpoint not registered",
      counts: {},
    };
  }
  const provider = JSON.parse(readFileSync(cfgPath, "utf8")).provider ?? {};
  const { base_url: baseUrl, api_type: apiType, model } = provider;
  if (!baseUrl || apiType !== "responses" || !model) {
    return {
      verdict: "NOT_RUN",
      reason: `provider config incomplete (base_url=${baseUrl || "?"}, api_type=${apiType}, model=${model || "?"})`,
      counts: {},
    };
  }

  // 1. /v1/models — registered route must be listed.
  const modelsRes = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(15_000) });
  if (!modelsRes.ok) {
    return { verdict: "RED", reason: `GET /v1/models -> ${modelsRes.status}`, counts: {} };
  }
  const models = (await modelsRes.json()).data ?? [];
  const listed = models.some((m) => m.id === model);
  if (!listed) {
    return { verdict: "RED", reason: `registered model ${model} not in /v1/models`, counts: { modelCount: models.length } };
  }

  // 2. Non-stream responses call.
  const t0 = Date.now();
  const res1 = await postResponses(baseUrl, {
    model,
    input: "reply with exactly: ok",
    max_output_tokens: 512,
  });
  const ms1 = Date.now() - t0;
  if (!res1.ok) {
    return { verdict: "RED", reason: `POST /v1/responses -> ${res1.status}`, counts: {} };
  }
  const body1 = await res1.json();
  const msg = (body1.output ?? []).find((o) => o.type === "message");
  const text = msg?.content?.find((c) => c.type === "output_text")?.text ?? "";
  if (body1.status !== "completed" || !text) {
    return { verdict: "RED", reason: `non-stream incomplete: status=${body1.status} text=${JSON.stringify(text)}`, counts: {} };
  }

  // 3. Tool call round-trip (function_call output item).
  const res2 = await postResponses(baseUrl, {
    model,
    input: "What is the weather in Tokyo? Use the get_weather tool.",
    max_output_tokens: 1024,
    tools: [TOOL],
    tool_choice: "auto",
  });
  const body2 = await res2.json();
  const fc = (body2.output ?? []).find((o) => o.type === "function_call");
  let args = null;
  try { args = fc ? JSON.parse(fc.arguments) : null; } catch {}
  const toolOk = Boolean(fc && fc.call_id && args && typeof args.city === "string");

  // 4. Streaming — canonical event sequence via SSE.
  const t3 = Date.now();
  const res3 = await postResponses(baseUrl, {
    model,
    input: "count 1 to 3",
    max_output_tokens: 1024,
    tools: [TOOL],
  }, { stream: true });
  const streamText = await res3.text();
  const ms3 = Date.now() - t3;
  const events = sseEvents(streamText);
  const names = events.map((e) => e.event);
  const seq = (a, b) => names.indexOf(a) !== -1 && names.indexOf(a) < names.indexOf(b);
  const streamChecks = {
    createdFirst: names[0] === "response.created",
    completedLast: names[names.length - 1] === "response.completed",
    itemAdded: names.includes("response.output_item.added"),
    someDelta: names.some((n) => n.endsWith(".delta")),
    completedAfterCreated: seq("response.created", "response.completed"),
  };

  const checks = {
    modelListed: true,
    nonStreamCompleted: body1.status === "completed",
    nonStreamText: /\bok\b/i.test(text) && text.length < 64,
    toolCall: toolOk,
    ...streamChecks,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    verdict: failed.length ? "RED" : "PASS",
    reason: failed.length
      ? `live magpie probe failed: ${failed.join(",")}`
      : `live magpie OK: model ${model} — non-stream+tool-call+stream all canonical (${events.length} SSE events, ${ms1}ms/${ms3}ms)`,
    counts: {
      modelCount: models.length,
      nonStreamMs: ms1,
      streamMs: ms3,
      sseEvents: events.length,
      functionCall: fc ? 1 : 0,
    },
    timing: { diagnostic: true, samples: [ms1, ms3], p50: Math.round((ms1 + ms3) / 2), p95: Math.max(ms1, ms3), unit: "ms" },
    remoteOps: 4,
    detail: {
      endpoint: baseUrl,
      model,
      apiType,
      envClass: "host-local-live",
      nonStreamReply: text,
      toolArgs: args,
      streamEventTaxonomy: [...new Set(names)],
    },
  };
}
