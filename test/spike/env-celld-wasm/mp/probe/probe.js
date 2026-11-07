// Probe v2：S1（纯逻辑）+ L3（effect→wx.storage executor 桥）
// + L4（跨实例持久化回路）+ L1（多实例隔离 / QuickJS 引擎探测）。
const WASM = "wasm/celld-probe.wasm";
// 任意 import 的 no-op 垫片（probe_run 不调用 host_effect；quickjs 需要 env/wasi）
const STUB = () => new Proxy({}, { get: () => () => 0 });
const STUB_IMPORTS = () => ({ env: STUB(), wasi_snapshot_preview1: STUB() });
const OWNER_KEY = "spike:owner:demo-cell";
const STATE_KEY = "spike:state:demo-cell";

function apiSurface() {
  const w = typeof WXWebAssembly === "undefined" ? null : WXWebAssembly;
  return {
    wxWasm: typeof WXWebAssembly,
    wxWasmModule: w ? typeof w.Module : "absent",
    wxWasmInstance: w ? typeof w.Instance : "absent",
    wxWasmMemory: w ? typeof w.Memory : "absent",
    stdWasm: typeof WebAssembly,
  };
}

function utf8Decode(buf) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(buf);
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
}

function readOut(instance, p) {
  const ex = instance.exports;
  const len = ex.probe_output_len(p);
  const ptr = ex.probe_output_ptr(p);
  const bytes = new Uint8Array(ex.memory.buffer, ptr, len);
  const text = utf8Decode(bytes);
  ex.probe_destroy(p);
  return text;
}

// ── L3 executor：wasm effect → WX 原语 ────────────────────────────────
function makeHost(memRef) {
  const host = (kind, op, ptr, len) => {
    let arg = "";
    try {
      const buf = memRef.instance ? new Uint8Array(memRef.instance.exports.memory.buffer, ptr, len) : null;
      if (buf) arg = utf8Decode(buf);
    } catch (e) {}
    try {
      switch (kind) {
        case 1: { // ReadOwner
          const rec = wx.getStorageSync(OWNER_KEY);
          return rec && rec.epoch >= 0 ? rec.epoch : -1;
        }
        case 2: { // CasOwner "cell:epoch"
          const parts = arg.split(":");
          wx.setStorageSync(OWNER_KEY, { node: "node-a", epoch: Number(parts[1]) });
          return 0;
        }
        case 3: { // Restore → 持久化 state
          const blob = wx.getStorageSync(STATE_KEY);
          return blob ? String(blob).length : -1;
        }
        case 4: return 0; // StartRuntime
        case 5: { // Publish → 写 cell state
          wx.setStorageSync(STATE_KEY, "cell-state@" + arg);
          return 0;
        }
        case 6: return 0; // Complete
        case 7: { const i = arg.indexOf("="); wx.setStorageSync(arg.slice(0, i), arg.slice(i + 1)); return arg.length; }
        case 8: { const v = wx.getStorageSync(arg); return v ? String(v).length : -1; }
        default: return -1;
      }
    } catch (e) {
      return -2;
    }
  };
  return host;
}

async function runHosted() {
  const memRef = { instance: null };
  const { instance } = await WXWebAssembly.instantiate(WASM, { env: { host_effect: makeHost(memRef) } });
  memRef.instance = instance;
  const ex = instance.exports;
  const p = ex.probe_create();
  ex.probe_run_hosted(p);
  const text = readOut(instance, p);
  return { transcript: text, memoryBytes: ex.memory ? ex.memory.buffer.byteLength : null };
}

async function runCelld() {
  const t0 = Date.now();
  try {
    const { instance } = await WXWebAssembly.instantiate(WASM, STUB_IMPORTS());
    const instantiateMs = Date.now() - t0;
    const ex = instance.exports;
    const memoryBytes = ex.memory ? ex.memory.buffer.byteLength : null;
    const p = ex.probe_create();
    ex.probe_run(p);
    const transcript = readOut(instance, p);
    return { instantiateOk: true, instantiateMs, memoryBytes, transcriptBytes: transcript.length, transcript };
  } catch (e) {
    return { instantiateOk: false, error: String((e && e.message) || e), transcript: "" };
  }
}

// ── L3：effect 桥（fresh store）────────────────────────────────────────
async function runL3() {
  try {
    wx.removeStorageSync(OWNER_KEY);
    wx.removeStorageSync(STATE_KEY);
    const r = await runHosted();
    let doc = null;
    try { doc = JSON.parse(r.transcript); } catch {}
    const hostLog = (doc && doc.steps || []).flatMap((s) => s.host || []);
    return {
      ok: !!(doc && doc.tail && doc.tail.completed_local === true),
      transcriptBytes: r.transcript.length,
      hostCalls: hostLog,
      completedLocal: doc?.tail?.completed_local ?? null,
      steps: doc?.tail?.steps ?? null,
      ownerPersisted: !!wx.getStorageSync(OWNER_KEY),
      statePersisted: !!wx.getStorageSync(STATE_KEY),
      memoryBytes: r.memoryBytes,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ── L4：跨实例持久化回路 ─────────────────────────────────────────────
async function runL4() {
  try {
    // 相位 A：fresh store 跑一轮（L3 已建 owner+state）
    wx.removeStorageSync(OWNER_KEY);
    wx.removeStorageSync(STATE_KEY);
    const a = await runHosted();
    // 相位 B：全新 wasm 实例，同 store —— 读到持久化 owner/state
    const b = await runHosted();
    let da = null, db = null;
    try { da = JSON.parse(a.transcript); } catch {}
    try { db = JSON.parse(b.transcript); } catch {}
    const ha = (da?.steps || []).flatMap((s) => s.host || []);
    const hb = (db?.steps || []).flatMap((s) => s.host || []);
    const readA = ha.find((h) => h.startsWith("ReadOwner->"));
    const readB = hb.find((h) => h.startsWith("ReadOwner->"));
    return {
      ok: a.transcript !== b.transcript && readA === "ReadOwner->-1" && readB && readB !== "ReadOwner->-1",
      freshReadOwner: readA ?? null,
      warmReadOwner: readB ?? null,
      transcriptsDiffer: a.transcript !== b.transcript,
      warmCompletedLocal: db?.tail?.completed_local ?? null,
      warmSteps: db?.tail?.steps ?? null,
      ownerPersisted: !!wx.getStorageSync(OWNER_KEY),
      statePersisted: !!wx.getStorageSync(STATE_KEY),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ── L1：多实例隔离 + QuickJS 引擎探测 ────────────────────────────────
async function runL1() {
  const out = { isolation: null, engine: null };
  try {
    const r1 = await WXWebAssembly.instantiate(WASM, STUB_IMPORTS());
    const r2 = await WXWebAssembly.instantiate(WASM, STUB_IMPORTS());
    const i1 = r1.instance, i2 = r2.instance;
    const p1 = i1.exports.probe_create();
    const p2 = i2.exports.probe_create();
    i1.exports.probe_run(p1);
    i2.exports.probe_run(p2);
    const t1 = readOut(i1, p1);
    const t2 = readOut(i2, p2);
    out.isolation = {
      ok: t1 === t2 && i1.exports.memory !== i2.exports.memory && i1.exports.memory.buffer !== i2.exports.memory.buffer,
      memoriesDistinct: i1.exports.memory !== i2.exports.memory,
      deterministic: t1 === t2,
      memory1: i1.exports.memory.buffer.byteLength,
      memory2: i2.exports.memory.buffer.byteLength,
    };
  } catch (e) {
    out.isolation = { ok: false, error: String((e && e.message) || e) };
  }
  // QuickJS 引擎：裸 C API 直连（JS_NewRuntime → JS_NewContext → JS_Eval → JS_ToInt32）
  try {
    const fs = wx.getFileSystemManager();
    fs.accessSync("wasm/quickjs.wasm");
    try {
      const { instance } = await WXWebAssembly.instantiate("wasm/quickjs.wasm", STUB_IMPORTS());
      const ex = instance.exports;
      if (ex._initialize) ex._initialize();
      const enc = (str) => { const a = []; for (let i = 0; i < str.length; i++) a.push(str.charCodeAt(i) & 0xff); return a; };
      const put = (str) => { const ptr = ex.malloc(str.length + 1); const mem = new Uint8Array(ex.memory.buffer, ptr, str.length + 1); mem.set(enc(str)); mem[str.length] = 0; return ptr; };
      const rt = ex.JS_NewRuntime();
      const ctx = ex.JS_NewContext(rt);
      const ev = (code) => {
        const cp = put(code), fp = put("<probe>");
        const v = ex.JS_Eval(ctx, cp, code.length, fp, 0);
        const outp = ex.malloc(4);
        const rc = ex.JS_ToInt32(ctx, outp, v);
        const val = new Int32Array(ex.memory.buffer, outp, 1)[0];
        try { ex.JS_FreeValue(ctx, v); } catch (e) {}
        ex.free ? ex.free(cp) : null; ex.free ? ex.free(fp) : null; ex.free ? ex.free(outp) : null;
        return rc === 0 ? val : "ERR:rc" + rc;
      };
      const a = ev("1+1");
      const b = ev("((x,y)=>x*y)(6,7)");
      try { ex.JS_FreeContext(ctx); } catch (e) {}
      try { ex.JS_FreeRuntime(rt); } catch (e) {}
      out.engine = {
        artifact: true, instantiateOk: true,
        jsRan: a === 2 && b === 42,
        results: { onePlusOne: a, lambda: b },
        exports: Object.keys(ex).filter((k) => /^JS_/.test(k)).length,
        memoryBytes: ex.memory ? ex.memory.buffer.byteLength : null,
      };
    } catch (e) {
      out.engine = { artifact: true, instantiateOk: true, jsRan: false, error: String((e && e.message) || e) };
    }
  } catch (e) {
    out.engine = { artifact: false, note: "quickjs.wasm not provisioned" };
  }
  return out;
}

async function runBad() {
  try {
    await WXWebAssembly.instantiate("wasm/bad.wasm", {});
    return { threw: false };
  } catch (e) {
    return { threw: true, name: e && e.name ? String(e.name) : null };
  }
}

async function runAllProbes(stage) {
  const report = { apiSurface: apiSurface() };
  if (stage) stage("celld");
  report.celld = await runCelld();
  if (stage) stage("l3");
  report.l3 = await runL3();
  if (stage) stage("l4");
  report.l4 = await runL4();
  if (stage) stage("l1");
  report.l1 = await runL1();
  if (stage) stage("bad");
  report.bad = await runBad();
  return report;
}

module.exports = { runAllProbes };
