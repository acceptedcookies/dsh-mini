// AG-H1 驱动：Node 宿主下真实 fx-core-async.wasm → magpie 的完整 agent turn。
// 用法: node lib/drive.mjs [--tool]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createFxRuntime } from "./fx-host.mjs";
import { createAcpClient } from "./acp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const cfg = JSON.parse(readFileSync(join(repoRoot, ".local.development.json"), "utf8"));
const provider = cfg.provider;
const baseUrl = provider.base_url;
const model = provider.model;
const wasmPath = join(here, "../fixtures/fx-core-async.wasm");

const providersJson = JSON.stringify({
  magpie: {
    protocol: "openai-chat-completions",
    base_url: `${baseUrl}/v1`,
    auth: { type: "none" },
    model_metadata: {
      [model]: { context_window: cfg.catalog?.[model]?.context_window ?? 500000, supports_tool_use: true, supports_vision: true },
      unknown: { context_window: 256000, supports_tool_use: true, supports_vision: true },
    },
  },
});

const log = (...a) => console.log("[drive]", ...a);

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
  env: {
    FX_PROVIDER: "magpie",
    FX_CONFIGURED_PROVIDERS: providersJson,
    FX_MODEL: model,
  },
  stderr: (c) => process.stderr.write(`[wasm-err] ${new TextDecoder().decode(c)}`),
  hostToolExecutor: async (name, input, _sid, callId) => {
    log(`tool call: ${name}(${JSON.stringify(input)}) callId=${callId}`);
    toolCalls.push({ name, input, callId });
    const result = weatherTool(name, input);
    return result;
  },
});

const toolCalls = [];
function weatherTool(name, input) {
  if (name === "get_weather") {
    return { content: JSON.stringify({ city: input.city, temp_c: 22, condition: "sunny", source: "spike-fixture" }), isError: false };
  }
  return { content: `unknown tool ${name}`, isError: true };
}

const updates = [];
const client = createAcpClient(runtime, {
  tools: [
    { name: "get_weather", description: "Get current weather for a city",
      inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
  ],
  executeTool: async (name, input, callId) => {
    log(`libfx/tool_call: ${name}(${JSON.stringify(input)})`);
    toolCalls.push({ name, input, callId, via: "acp" });
    return weatherTool(name, input);
  },
  onUpdate: (u) => { updates.push(u); process.stdout.write("."); },
  onPermission: async () => null,
  onMessage: (m) => { if (m.method && m.method !== "session/update") log("rx:", m.method, m.id !== undefined ? `#${m.id}` : ""); },
  onProtocolError: (e, line) => log("PROTOCOL ERROR:", e.message, new TextDecoder().decode(line).slice(0, 200)),
});

const useTool = process.argv.includes("--tool");
try {
  log(`wasm: ${wasmPath}`);
  const t0 = Date.now();
  await runtime.start(wasmPath);
  log(`instantiated+_start in ${Date.now() - t0}ms`);
  const sid = await client.connect();
  log(`session: ${sid}`);
  const text = useTool
    ? "What is the weather in Tokyo right now? You must call the get_weather tool, then answer briefly."
    : "Reply with exactly one word: ok";
  log(`prompt: ${text}`);
  const t1 = Date.now();
  const result = await client.prompt(text);
  console.log("");
  log(`prompt done in ${Date.now() - t1}ms, stopReason=${JSON.stringify(result?.stopReason)}`);
  const textDeltas = updates.filter((u) => u?.sessionUpdate === "agent_message_chunk");
  const textOut = textDeltas.map((u) => u.content?.text || "").join("");
  const toolUpdates = updates.filter((u) => u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update");
  log(`message chunks: ${textDeltas.length}, tool updates: ${toolUpdates.length}, host tool executions: ${toolCalls.length}`);
  for (const u of toolUpdates) log(`update: ${JSON.stringify(u)}`);
  log(`final text: ${JSON.stringify(textOut.slice(0, 400))}`);
  if (useTool) log(`tool calls: ${JSON.stringify(toolCalls)}`);
  log("PASS");
  process.exit(0);
} catch (e) {
  console.log("");
  log("FAIL:", e.stack || e);
  log(`exitCode=${runtime.exitCode} error=${runtime.error}`);
  process.exit(1);
}
