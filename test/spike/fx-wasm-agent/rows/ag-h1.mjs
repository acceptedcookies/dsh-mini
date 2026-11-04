// AG-H1 — Node 宿主下真实 fx-core-async.wasm → magpie 完整 agent turn + tool-call 循环。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFxRuntime } from "../lib/fx-host.mjs";
import { createAcpClient } from "../lib/acp.mjs";

const weatherExec = (name, input) => name === "get_weather"
  ? { content: JSON.stringify({ city: input.city, temp_c: 22, condition: "sunny", source: "spike-fixture" }), isError: false }
  : { content: `unknown tool ${name}`, isError: true };

async function runTurn(spikeDir, repoRoot, promptText, withTools) {
  const cfg = JSON.parse(readFileSync(join(repoRoot, ".local.development.json"), "utf8"));
  const { base_url, model } = cfg.provider;
  const providersJson = JSON.stringify({
    magpie: {
      protocol: "openai-chat-completions",
      base_url: `${base_url}/v1`,
      auth: { type: "none" },
      model_metadata: {
        [model]: { context_window: cfg.catalog?.[model]?.context_window ?? 500000, supports_tool_use: true, supports_vision: true },
        unknown: { context_window: 256000, supports_tool_use: true, supports_vision: true },
      },
    },
  });
  const toolCalls = [], updates = [];
  const runtime = createFxRuntime({
    fetch: (url, init) => fetch(url, init),
    getRandomValues: (b) => crypto.getRandomValues(b),
    instantiate: async (input, imports) => {
      const bytes = typeof input === "string" ? readFileSync(input) : input;
      const { module: m, instance } = await WebAssembly.instantiate(bytes, imports);
      return { module: m, instance };
    },
    TextEncoder, TextDecoder,
    WasmExit: class WasmExit extends Error {},
  }, {
    args: ["acp"],
    env: { FX_PROVIDER: "magpie", FX_CONFIGURED_PROVIDERS: providersJson, FX_MODEL: model },
    stderr: () => {},
    hostToolExecutor: async (name, input, _sid, callId) => {
      toolCalls.push({ name, input, callId, via: "import" });
      return weatherExec(name, input);
    },
  });
  const client = createAcpClient(runtime, {
    tools: withTools ? [{ name: "get_weather", description: "Get current weather for a city",
      inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] : [],
    executeTool: async (name, input, callId) => {
      toolCalls.push({ name, input, callId, via: "acp" });
      return weatherExec(name, input);
    },
    onUpdate: (u) => updates.push(u),
    onPermission: async () => null,
  });
  const t0 = Date.now();
  await runtime.start(join(spikeDir, "fixtures/fx-core-async.wasm"));
  const sessionId = await client.connect();
  const t1 = Date.now();
  const result = await client.prompt(promptText);
  const elapsed = Date.now() - t1;
  const text = updates.filter((u) => u?.sessionUpdate === "agent_message_chunk")
    .map((u) => u.content?.text || "").join("");
  return { sessionId, result, text, toolCalls, updates, elapsed, instantiateMs: t1 - t0 };
}

export async function run({ spikeDir, repoRoot }) {
  const t0 = Date.now();
  // 段 1：纯文本 turn
  const plain = await runTurn(spikeDir, repoRoot, "Reply with exactly one word: ok", false);
  // 段 2：tool-call 循环
  const tooled = await runTurn(spikeDir, repoRoot,
    "What is the weather in Tokyo right now? You must call the get_weather tool, then answer briefly.", true);

  // 镜像 P-agent-session：同一校验器对畸形 sessionId 必须拒（fired），对真实值必须收（restored）
  const sessionIdOk = (s) => typeof s === "string" && s.length >= 6;
  const plants = [{ id: "P-agent-session", fired: !sessionIdOk("!!"), restored: sessionIdOk(plain.sessionId) }];

  const checks = {
    plainCompleted: plain.result?.stopReason === "end_turn",
    plainTextOk: /\bok\b/i.test(plain.text) && plain.text.length < 64,
    plainSession: typeof plain.sessionId === "string" && plain.sessionId.length >= 6,
    toolCompleted: tooled.result?.stopReason === "end_turn",
    toolExecuted: tooled.toolCalls.some((c) => c.name === "get_weather" && c.input?.city === "Tokyo"),
    toolAnswerUsedFixture: tooled.text.includes("22") && /sunny/i.test(tooled.text),
    toolUpdatesStreamed: tooled.updates.some((u) => u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update"),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    verdict: failed.length ? "RED" : "PASS",
    reason: failed.length ? `failed: ${failed.join(",")}` : "真实 fx-core.wasm 在 Node 宿主完成文本 turn 与 tool-call 循环",
    counts: {
      wasmBytes: 4098991,
      plainUpdates: plain.updates.length,
      tooledUpdates: tooled.updates.length,
      toolCalls: tooled.toolCalls.length,
    },
    timing: { diagnostic: { plainMs: plain.elapsed, tooledMs: tooled.elapsed, totalMs: Date.now() - t0 } },
    remoteOps: 2,
    plants,
    detail: {
      model: "cursor/grok-4.7@500k",
      plainText: plain.text.slice(0, 200),
      toolText: tooled.text.slice(0, 200),
      toolCalls: tooled.toolCalls,
      plainSession: plain.sessionId,
      tooledSession: tooled.sessionId,
    },
  };
}
