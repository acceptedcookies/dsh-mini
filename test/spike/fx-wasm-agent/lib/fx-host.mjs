// fx-core.wasm 的宿主运行时：wasm-runtime.js 的移植版。
// 差异：JSPI Suspending/promising → binaryen Asyncify 驱动；
// fetch/TextEncoder 等宿主能力经 env 注入，使同一层可在 Node 与 WXWebAssembly 下运行。

const ASYNCIFY_PAGE_BYTES = 65536;

export function createFxRuntime(env, options) {
  const encoder = new env.TextEncoder();
  const decoder = new env.TextDecoder();
  const stdin = { chunks: [], waiters: [], closed: false,
    push(b) { if (this.closed) throw new Error("stdin closed"); if (b.length) { this.chunks.push(b); this.wake(); } },
    read(max) { if (!this.chunks.length) return null; const c = this.chunks[0];
      const v = c.subarray(0, max); if (v.length === c.length) this.chunks.shift(); else this.chunks[0] = c.subarray(v.length); return v; },
    wait(t) { if (this.closed) return Promise.resolve(true);
      return new Promise((resolve) => { let done = false; let timer;
        const w = () => { if (done) return; done = true; if (timer !== undefined) clearTimeout(timer); resolve(true); };
        this.waiters.push(w);
        if (t !== undefined) timer = setTimeout(() => { if (done) return; done = true;
          const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); resolve(false); }, t); }); },
    close() { this.closed = true; this.wake(); },
    wake() { this.waiters.splice(0).forEach((w) => w()); } };

  const streams = new Map();
  const httpRequests = new Set();
  const steering = [];
  let steeringOpen = false, steeringHandoff = false, steeringBytes = 0;
  let instance, exports_, dataAddr = -1;
  let nextHandle = 1;
  let exitedResolve; const exited = new Promise((r) => { exitedResolve = r; });
  let exitCode = null, aborted = false, abortError = null;
  const markExited = (c) => { if (exitCode === null) { exitCode = c; exitedResolve(c); } };

  const memory = () => instance.exports.memory;
  const bytes = (ptr, len) => new Uint8Array(memory().buffer, ptr, len);
  const text = (ptr, len) => decoder.decode(bytes(ptr, len));
  const writeU32 = (ptr, v) => new DataView(memory().buffer).setUint32(ptr, v, true);
  const writeU64 = (ptr, v) => new DataView(memory().buffer).setBigUint64(ptr, BigInt(v), true);

  // ---- asyncify 驱动 ----
  const S_NORMAL = 0, S_UNWINDING = 1, S_REWINDING = 2;
  let pendingResult, pendingFailure, running = false;
  const astate = () => exports_.asyncify_get_state();
  function resume() {
    if (!running) return;
    exports_.asyncify_start_rewind(dataAddr);
    try { exports_._start(); } catch (e) { onStartError(e); }
  }
  function onStartError(e) {
    running = false;
    if (String(e).includes("proc_exit")) { markExited(exitCode ?? 0); }
    else { abortError = e; abortHostEffects(); stdin.close(); markExited(aborted ? 130 : 1); }
    options.onStartSettled?.(e);
  }
  function suspending(fn, dummy = 0) {
    return (...args) => {
      if (astate() === S_REWINDING) {
        exports_.asyncify_stop_rewind();
        const f = pendingFailure; pendingFailure = undefined;
        if (f !== undefined) return f.dummy ? f.value : -1; // 宿主失败一律 -1
        const v = pendingResult; pendingResult = undefined; return v;
      }
      const r = fn(...args);
      if (r === null || typeof r !== "object" || typeof r.then !== "function") return r; // 同步快路径
      r.then((v) => { pendingResult = v; resume(); },
             (e) => { pendingFailure = { dummy: true, value: -1 }; resume(); });
      exports_.asyncify_start_unwind(dataAddr);
      return dummy;
    };
  }

  // ---- WASI ----
  const args = options.args || [];
  const environ = Object.entries(options.env || {}).map(([k, v]) => `${k}=${v}`);
  function writeVector(values, ptrs, data) {
    let cursor = data;
    values.forEach((v, i) => { const enc = encoder.encode(`${v}\0`); writeU32(ptrs + i * 4, cursor); bytes(cursor, enc.length).set(enc); cursor += enc.length; });
  }
  let stdoutHandler = options.stdout;
  function fdWrite(fd, iovs, count, nwritten) {
    const view = new DataView(memory().buffer);
    let total = 0;
    for (let i = 0; i < count; i++) total += view.getUint32(iovs + i * 8 + 4, true);
    if (fd === 1 || fd === 2) {
      const chunk = new Uint8Array(total); let off = 0;
      for (let i = 0; i < count; i++) { const p = view.getUint32(iovs + i * 8, true); const l = view.getUint32(iovs + i * 8 + 4, true); chunk.set(bytes(p, l), off); off += l; }
      if (fd === 1) { const pending = stdoutHandler?.(chunk); if (pending && typeof pending.then === "function") return pending.then(() => { writeU32(nwritten, total); return 0; }); }
      else options.stderr ? options.stderr(chunk) : console.warn("[fx-wasm stderr]", decoder.decode(chunk));
    }
    writeU32(nwritten, total);
    return 0;
  }
  function fdRead(fd, iovs, count, nread) {
    if (fd !== 0) return 8;
    const attempt = () => {
      const view = new DataView(memory().buffer); let total = 0;
      for (let i = 0; i < count; i++) { const p = view.getUint32(iovs + i * 8, true); const l = view.getUint32(iovs + i * 8 + 4, true);
        const c = stdin.read(l); if (!c) break; bytes(p, c.length).set(c); total += c.length; if (c.length < l) break; }
      if (total) { writeU32(nread, total); return 0; } return null;
    };
    const imm = attempt(); if (imm !== null) return imm;
    if (stdin.closed) { writeU32(nread, 0); return 0; }
    return stdin.wait().then(() => { const r = attempt(); if (r !== null) return r; writeU32(nread, 0); return 0; });
  }
  function pollOneoff(subscriptions, events, count, nevents) {
    const view = new DataView(memory().buffer);
    for (let i = 0; i < count; i++) { const base = subscriptions + i * 48;
      if (view.getUint8(base + 8) === 1 && stdin.chunks.length) {
        bytes(events, 32).fill(0); bytes(events, 8).set(bytes(base, 8)); view.setUint8(events + 10, 1); writeU32(nevents, 1); return 0; } }
    let timeout = null;
    for (let i = 0; i < count; i++) { const base = subscriptions + i * 48;
      if (view.getUint8(base + 8) === 0) timeout = Number(view.getBigUint64(base + 24, true) / 1000000n); }
    return stdin.wait(timeout === null ? undefined : timeout).then(() => {
      bytes(events, 32).fill(0); bytes(events, 8).set(bytes(subscriptions, 8)); writeU32(nevents, 1); return 0; });
  }
  const unavailable = () => 52;

  // ---- fx http 流式 ----
  function headersObj(ptr, len) { const h = {}; for (const { name, value } of JSON.parse(text(ptr, len) || "[]")) h[name] = value; return h; }
  function streamOpen(mp, ml, up, ul, hp, hl, bp, bl) {
    const handle = nextHandle++;
    const state = { response: null, responseError: null, pendingRead: null, readResult: null, readError: null, leftover: new Uint8Array(), abort: null };
    streams.set(handle, state);
    state.settled = Promise.resolve().then(() => env.fetch(text(up, ul), {
      method: text(mp, ml), headers: headersObj(hp, hl), body: bl ? bytes(bp, bl).slice() : undefined,
    })).then((r) => { state.response = r; }).catch((e) => { state.responseError = e; });
    return handle;
  }
  function streamStatus(handle, statusOut) {
    const st = streams.get(handle); if (!st) return -1;
    const settled = () => {
      if (st.responseError) return -1;
      if (!st.response) return 0;
      new DataView(memory().buffer).setUint16(statusOut, st.response.status, true); return 1; };
    const imm = settled(); if (imm !== 0) return imm;
    return st.settled.then(() => settled());
  }
  function streamNext(handle, outPtr, outCap) {
    const st = streams.get(handle); if (!st) return -1;
    const copy = (chunk) => { const w = chunk.subarray(0, outCap); bytes(outPtr, w.length).set(w); st.leftover = chunk.subarray(w.length); return w.length; };
    const consume = () => {
      if (st.leftover.length) return copy(st.leftover);
      if (st.readError) return -1;
      if (!st.readResult) return null;
      const { done, value } = st.readResult; st.readResult = null;
      if (done) return 0; if (!value?.length) return null;
      options.onTransportChunk?.(value.length);
      return copy(value); };
    const imm = consume(); if (imm !== null) return imm;
    if (!st.reader && st.response?.body) st.reader = typeof st.response.body.getReader === "function" ? st.response.body.getReader() : st.response.body;
    const reader = st.reader; if (!reader) return 0;
    if (!st.pendingRead) st.pendingRead = reader.read().then((r) => { st.readResult = r; st.pendingRead = null; })
      .catch((e) => { st.readError = e; st.pendingRead = null; });
    return st.pendingRead.then(() => { const r = consume(); return r === null ? -3 : r; });
  }

  function httpRequest(mp, ml, up, ul, hp, hl, bp, bl, statusOut, responsePtr, responseCap) {
    return Promise.resolve().then(() => env.fetch(text(up, ul), {
      method: text(mp, ml), headers: headersObj(hp, hl), body: bl ? bytes(bp, bl).slice() : undefined,
    })).then(async (r) => {
      const body = new Uint8Array(await r.arrayBuffer());
      new DataView(memory().buffer).setUint16(statusOut, r.status, true);
      if (body.length > responseCap) return -2;
      bytes(responsePtr, body.length).set(body);
      return body.length;
    }).catch(() => -1);
  }

  let pendingToolResult = null;
  function hostToolCall(np, nl, ap, al, op, oc, statusPtr, cip, cil) {
    pendingToolResult = null;
    if (typeof options.hostToolExecutor !== "function") return -1;
    let input; try { input = JSON.parse(text(ap, al)); } catch { return -1; }
    return Promise.resolve(options.hostToolExecutor(text(np, nl), input, undefined, text(cip, cil))).then((res) => {
      if (res.cancelled) return -2;
      const out = encoder.encode(res.content);
      bytes(statusPtr, 1)[0] = (res.isError ? 1 : 0) + (res.rich ? 2 : 0);
      if (out.length > oc) { if (!res.rich || out.length > 8 * 1024 * 1024) return -3; pendingToolResult = out; return out.length; }
      bytes(op, out.length).set(out); return out.length;
    }).catch(() => -1);
  }

  function steeringTake(op, oc) {
    const e = steering[0]; if (!e) return 0;
    const id = encoder.encode(e.id); const l = id.length + 1 + e.value.length;
    if (l > oc) return -1;
    const out = bytes(op, oc); out.set(id, 0); out[id.length] = 10; out.set(e.value, id.length + 1);
    steering.shift(); steeringBytes -= e.value.length; return l;
  }
  function abortHostEffects() {
    pendingToolResult = null;
    streams.forEach((s) => s.abort?.()); streams.clear();
    httpRequests.forEach((c) => c.abort()); httpRequests.clear();
  }

  const wasi = {
    args_sizes_get(c, s) { writeU32(c, args.length); writeU32(s, args.reduce((n, v) => n + encoder.encode(v).length + 1, 0)); return 0; },
    args_get(p, d) { writeVector(args, p, d); return 0; },
    environ_sizes_get(c, s) { writeU32(c, environ.length); writeU32(s, environ.reduce((n, v) => n + encoder.encode(v).length + 1, 0)); return 0; },
    environ_get(p, d) { writeVector(environ, p, d); return 0; },
    fd_write: suspending(fdWrite),
    fd_read: suspending(fdRead),
    fd_close() { return 0; },
    fd_fdstat_get(fd, out) { bytes(out, 24).fill(0); const v = new DataView(memory().buffer);
      v.setUint8(out, fd <= 2 ? 2 : 0); v.setBigUint64(out + 8, 0xffffffffffffffffn, true); v.setBigUint64(out + 16, 0xffffffffffffffffn, true); return 0; },
    fd_filestat_get: unavailable, fd_filestat_set_size: unavailable, fd_filestat_set_times: unavailable,
    fd_pread: unavailable, fd_pwrite: unavailable, fd_readdir: unavailable,
    fd_prestat_get() { return 8; }, fd_prestat_dir_name: unavailable, fd_seek() { return 29; }, fd_sync() { return 0; },
    clock_res_get(_id, out) { writeU64(out, 1000000n); return 0; },
    clock_time_get(_id, _p, out) { writeU64(out, BigInt(Date.now()) * 1000000n); return 0; },
    path_create_directory: unavailable, path_filestat_get: unavailable, path_filestat_set_times: unavailable,
    path_link: unavailable, path_open: unavailable, path_readlink: unavailable,
    path_remove_directory: unavailable, path_rename: unavailable, path_symlink: unavailable, path_unlink_file: unavailable,
    random_get(ptr, len) { env.getRandomValues(bytes(ptr, len)); return 0; },
    poll_oneoff: suspending(pollOneoff),
    proc_exit(code) { markExited(code); throw new env.WasmExit(`proc_exit(${code})`); },
  };

  const fx = {
    fx_term_poll_input: suspending((t) => { options.onTerminalPoll?.();
      if (stdin.chunks.length) return 1; if (stdin.closed) return -1; if (t === 0) return 0;
      return stdin.wait(t >= 0 ? t : undefined).then(() => stdin.chunks.length ? 1 : (stdin.closed ? -1 : 0)); }),
    fx_clipboard_copy: suspending((vp, vl) => Promise.resolve(0)),
    fx_prompt_history_available() { return 0; },
    fx_workspace_available() { return options.workspace ? 1 : 0; },
    fx_workspace_info(op, oc) { return -2; },
    fx_workspace_exec: suspending(() => Promise.resolve(-2)),
    fx_workspace_read_file: suspending(() => Promise.resolve(-2)),
    fx_http_stream_open: streamOpen,
    fx_http_stream_status: suspending(streamStatus),
    fx_http_stream_next: suspending(streamNext),
    fx_http_stream_close(h) { streams.delete(h); },
    fx_http_request: suspending(httpRequest),
    fx_host_tool_call: suspending(hostToolCall),
    fx_journal_flush: suspending(() => Promise.resolve(typeof options.journalFlush === "function" ? options.journalFlush().then(() => 0, () => -1) : -1)),
    fx_host_tool_result_read(off, ptr, cap) {
      if (!pendingToolResult || off < 0 || off > pendingToolResult.length) return -1;
      const c = pendingToolResult.subarray(off, off + cap); bytes(ptr, c.length).set(c); return c.length; },
    fx_host_tool_result_release() { pendingToolResult = null; },
    fx_steering_take: steeringTake,
    fx_steering_close() { steeringOpen = false; steering.length = 0; steeringBytes = 0; steeringHandoff = false; },
    fx_steering_state() { return steeringOpen ? steering.length * 2 + (steeringHandoff ? 1 : 0) : -1; },
    fx_attachment_size() { return -1; },
    fx_attachment_take() { return -1; },
    fx_attachment_put() { return -1; },
    fx_open_url: suspending(() => Promise.resolve(0)),
    fx_oauth_session_load: suspending(() => Promise.resolve(-2)),
    fx_oauth_session_commit: suspending(() => Promise.resolve(-1)),
    fx_oauth_session_remove: suspending(() => Promise.resolve(-1)),
    fx_config_get: suspending((ip, il, op, oc) => {
      if (!options.configStore?.get) return -2;
      return Promise.resolve(options.configStore.get(text(ip, il))).then((v) => {
        if (v == null) return -2; const enc = encoder.encode(String(v)); if (enc.length > oc) return -3;
        bytes(op, enc.length).set(enc); return enc.length; }).catch(() => -1); }),
    fx_config_set: suspending((ip, il, vp, vl) => {
      if (!options.configStore?.set) return 0;
      return Promise.resolve(options.configStore.set(text(ip, il), text(vp, vl))).then(() => 0).catch(() => -1); }),
    fx_prompt_history_load: suspending(() => Promise.resolve(-1)),
    fx_prompt_history_append: suspending(() => Promise.resolve(-1)),
    fx_prompt_history_clear: suspending(() => Promise.resolve(-1)),
    fx_session_load: suspending(() => Promise.resolve(-2)),
    fx_session_commit: suspending(() => Promise.resolve(-1)),
    fx_session_list: suspending(() => Promise.resolve(-2)),
    fx_session_remove: suspending(() => Promise.resolve(-1)),
    fx_term_size(cols, rows) { const v = new DataView(memory().buffer); v.setUint16(cols, 80, true); v.setUint16(rows, 24, true); },
  };

  const api = {
    imports: { wasi_snapshot_preview1: wasi, fx },
    exited,
    write(d) { stdin.push(typeof d === "string" ? encoder.encode(d) : d); },
    wake() { stdin.wake(); },
    closeStdin() { steeringOpen = false; stdin.close(); },
    openSteering() { steering.length = 0; steeringBytes = 0; steeringHandoff = false; steeringOpen = true; },
    steer(t, id = "") { steering.push({ id, value: encoder.encode(t) }); },
    closeSteering() { steeringOpen = false; steering.length = 0; },
    abort(e) { aborted = true; abortError = e; abortHostEffects(); stdin.close(); markExited(130); },
    get aborted() { return aborted; }, get exitCode() { return exitCode; }, get error() { return abortError; },
    _setStdoutHandler(fn) { stdoutHandler = fn; },

    async start(wasmInput) {
      const { instance: inst } = await env.instantiate(wasmInput, api.imports);
      instance = inst; exports_ = inst.exports;
      // asyncify buffer：单独 grow 一页，Zig allocator 不复用宿主的页
      const pageIndex = exports_.memory.grow(1);
      dataAddr = pageIndex * ASYNCIFY_PAGE_BYTES;
      const view = new DataView(exports_.memory.buffer);
      view.setUint32(dataAddr, dataAddr + 8, true);
      view.setUint32(dataAddr + 4, dataAddr + ASYNCIFY_PAGE_BYTES, true);
      running = true;
      try { exports_._start(); } catch (e) { onStartError(e); }
      return api;
    },
  };
  return api;
}
