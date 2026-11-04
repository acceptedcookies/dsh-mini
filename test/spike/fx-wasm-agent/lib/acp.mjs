// 最小 ACP+libfx 客户端：只实现打通真实 turn 所需的方法面。
// initialize → libfx/new → session/prompt；处理 session/update 通知
// 与 libfx/tool_call / session/request_permission / libfx/journal_flush 请求。

export function createAcpClient(runtime, options) {
  const encoder = options.encoder || new TextEncoder();
  const decoder = options.decoder || new TextDecoder();
  const pending = new Map();
  let nextId = 1;
  let sessionId = null;
  let buf = new Uint8Array();

  const send = (msg) => runtime.write(encoder.encode(JSON.stringify(msg) + "\n"));
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });

  async function handleMessage(msg) {
    options.onMessage?.(msg);
    if (msg.id !== undefined && msg.method === undefined) {
      const w = pending.get(msg.id); if (!w) return; pending.delete(msg.id);
      if (msg.error) { const e = new Error(msg.error.message); e.data = msg.error.data; w.reject(e); }
      else w.resolve(msg.result);
      return;
    }
    if (msg.method === "session/update") {
      if (msg.params?.sessionId === sessionId) options.onUpdate?.(msg.params.update);
      return;
    }
    // 核心发来的请求（需应答）
    if (msg.method === "libfx/tool_call") {
      try {
        const res = await options.executeTool(msg.params?.name, msg.params?.input, msg.params?.toolCallId);
        send({ jsonrpc: "2.0", id: msg.id, result: { content: res.content, isError: !!res.isError, ...(res.rich ? { contentType: "rich" } : {}) } });
      } catch (e) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(e?.message || e) } });
      }
      return;
    }
    if (msg.method === "session/request_permission") {
      let optionId = null;
      try { optionId = await options.onPermission?.(msg.params); } catch {}
      send({ jsonrpc: "2.0", id: msg.id, result: optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } } });
      return;
    }
    if (msg.method === "libfx/journal_flush") {
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
  }

  // stdout 行拆分：每条 JSON-RPC 一行
  runtime._setStdoutHandler((chunk) => {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf); next.set(chunk, buf.length); buf = next;
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 10) continue;
      const line = buf.subarray(start, i); start = i + 1;
      if (!line.length) continue;
      try { void handleMessage(JSON.parse(decoder.decode(line))); }
      catch (e) { options.onProtocolError?.(e, line); }
    }
    buf = buf.subarray(start);
  });

  return {
    async connect() {
      await request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { libfx: { tools: options.tools || [] } },
      });
      const r = await request("libfx/new", {});
      sessionId = r.sessionId;
      return sessionId;
    },
    prompt(text) {
      return request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
    },
    cancel() { send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }); },
    get sessionId() { return sessionId; },
  };
}
