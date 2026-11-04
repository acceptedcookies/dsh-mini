import { createFxRuntime } from "../../fx/fx-host.js";
import { createAcpClient } from "../../fx/acp.js";
import { createWxEnv } from "../../fx/env.js";
import { FX_ENV, WASM_PATH, MODEL } from "../../fx/config.js";

const TOOLS = [
  {
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
];

function weatherExec(name, input) {
  if (name === "get_weather") {
    return { content: JSON.stringify({ city: input.city, temp_c: 22, condition: "sunny", source: "spike-fixture" }), isError: false };
  }
  return { content: `unknown tool ${name}`, isError: true };
}

Page({
  data: {
    prompt: "Reply with exactly one word: ok",
    output: "",
    log: "",
    busy: false,
    status: "idle",
  },

  onLoad() {
    this.log("ready, wasm=" + WASM_PATH);
  },

  log(line) {
    this.setData({ log: this.data.log + line + "\n" });
  },

  onInput(e) { this.setData({ prompt: e.detail.value }); },

  // AG-S3：仅实例化探针 — 分包路径加载 + asyncify 导出面 + memory.grow
  async onProbe() {
    const app = getApp();
    app.globalData.fxTest = { phase: "probe" };
    try {
      const env = createWxEnv();
      const runtime = createFxRuntime(env, { args: ["acp"], env: FX_ENV });
      const t0 = Date.now();
      const { instance } = await env.instantiate(WASM_PATH, runtime.imports);
      const ms = Date.now() - t0;
      const e = instance.exports;
      const grown = e.memory.grow(1);
      app.globalData.fxTest = {
        phase: "probe-done",
        instantiateMs: ms,
        start: typeof e._start === "function",
        asyncify: ["asyncify_get_state", "asyncify_start_unwind", "asyncify_stop_unwind", "asyncify_start_rewind", "asyncify_stop_rewind"]
          .filter((k) => typeof e[k] === "function"),
        memPagesBefore: grown,
        memPagesAfter: e.memory.buffer.byteLength / 65536,
        wasmPath: WASM_PATH,
      };
      this.log(`probe: ${ms}ms, mem ${grown}→${e.memory.buffer.byteLength / 65536}p`);
    } catch (err) {
      app.globalData.fxTest = { phase: "probe-error", error: String(err && err.message || err) };
      this.log("probe FAIL: " + (err.stack || err));
    }
  },

  async onSend() {
    if (this.data.busy) return;
    this.setData({ busy: true, output: "", status: "starting" });
    const app = getApp();
    app.globalData.fxTest = { phase: "starting", model: MODEL, text: "", toolCalls: [], updates: 0 };

    const toolCalls = [];
    const updates = [];
    try {
      const env = createWxEnv();
      const runtime = createFxRuntime(env, {
        args: ["acp"],
        env: FX_ENV,
        stderr: () => {},
        hostToolExecutor: async (name, input, _sid, callId) => {
          toolCalls.push({ name, input, callId });
          this.log(`tool: ${name}(${JSON.stringify(input)})`);
          return weatherExec(name, input);
        },
      });

      const client = createAcpClient(runtime, {
        encoder: new env.TextEncoder(),
        decoder: new env.TextDecoder(),
        tools: TOOLS,
        executeTool: async (name, input, callId) => {
          toolCalls.push({ name, input, callId, via: "acp" });
          return weatherExec(name, input);
        },
        onUpdate: (u) => {
          updates.push(u);
          const t = u?.sessionUpdate;
          if (t === "agent_message_chunk" && u.content?.text) {
            this.setData({ output: this.data.output + u.content.text });
            app.globalData.fxTest.text += u.content.text;
          }
          app.globalData.fxTest.updates = updates.length;
        },
        onPermission: async () => null,
        onProtocolError: (e) => this.log("proto-err: " + e.message),
      });

      this.log("instantiate…");
      this.setData({ status: "instantiate" });
      app.globalData.fxTest.phase = "instantiate";
      const t0 = Date.now();
      await runtime.start(WASM_PATH);
      this.log(`instantiated in ${Date.now() - t0}ms`);

      app.globalData.fxTest.phase = "connect";
      const sid = await client.connect();
      this.log(`session ${sid}`);
      app.globalData.fxTest.sessionId = sid;
      app.globalData.fxTest.phase = "prompt";

      const result = await client.prompt(this.data.prompt);
      this.log(`done stopReason=${result?.stopReason}`);
      app.globalData.fxTest.phase = "done";
      app.globalData.fxTest.toolCalls = toolCalls;
      app.globalData.fxTest.stopReason = result?.stopReason;
      this.setData({ status: "done", busy: false });
    } catch (e) {
      this.log("FAIL: " + (e.stack || e));
      app.globalData.fxTest.phase = "error";
      app.globalData.fxTest.error = String(e && e.message || e);
      app.globalData.fxTest.toolCalls = toolCalls;
      this.setData({ status: "error", busy: false });
    }
  },
});
