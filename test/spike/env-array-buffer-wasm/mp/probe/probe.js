// Probe implementation for the sim/device lanes (charter §3.2/§3.3).
// Arms: apiSurface / cryptoProbe / pathBaseline / bytesRaw / encPipeline / fxReal.
// transform.js mirrors lib/transform.mjs — keep the two in sync (verified by
// `harness/run.mjs --check`).
//
// Design notes (post-review):
// - Arms are selectable via `arms` so a row only pays for what it asserts; a
//   crash inside one arm cannot silently erase earlier arms' evidence because
//   the report is flushed incrementally via `flush(report)` after each arm.
// - All Module() calls on the main path receive a real ArrayBuffer
//   (`.buffer` of a fresh exact-size Uint8Array), so a rejection is a content
//   error, not a type error. Uint8Array-view acceptance is probed separately
//   (bytesRaw.moduleFromView).
// - Negative arms record the thrown error's `name` so CompileError/LinkError/
//   TypeError stay distinguishable in the receipt.
// - fxReal splits compile/introspect/stub-build/link stages so a failure is
//   attributed to the stage that failed (moduleOk/introspectErr/stubErr/linkErr).
// - fx-core-async.wasm: 55 function imports, 0 memory/table/global imports;
//   stubs are never invoked (we link, never run _start). stubCalls must stay 0
//   (P-stub-quiet).
const { xorCrypt, fnv1a32 } = require("./transform.js");

const ASYNCIFY_STATE_EXPORT = "asyncify_get_state";
const ALL_ARMS = ["cryptoProbe", "pathBaseline", "bytesRaw", "altEntries", "encPipeline", "fxReal"];

let httpOps = 0;
let httpBytes = 0;

function apiSurface() {
  const W = typeof WXWebAssembly === "undefined" ? null : WXWebAssembly;
  const S = typeof WebAssembly === "undefined" ? null : WebAssembly;
  const C = typeof crypto === "undefined" ? null : crypto;
  return {
    wxWasm: typeof WXWebAssembly,
    wxWasmModule: W ? typeof W.Module : "absent",
    wxWasmInstance: W ? typeof W.Instance : "absent",
    wxWasmMemory: W ? typeof W.Memory : "absent",
    wxWasmTable: W ? typeof W.Table : "absent",
    wxWasmGlobal: W ? typeof W.Global : "absent",
    wxWasmInstantiate: W ? typeof W.instantiate : "absent",
    wxWasmModuleImports: W && W.Module ? typeof W.Module.imports : "absent",
    wxWasmModuleExports: W && W.Module ? typeof W.Module.exports : "absent",
    wxWasmModuleCustomSections: W && W.Module ? typeof W.Module.customSections : "absent",
    wxWasmCompile: W ? typeof W.compile : "absent",
    wxWasmValidate: W ? typeof W.validate : "absent",
    stdWasm: typeof WebAssembly,
    stdWasmModule: S ? typeof S.Module : "absent",
    cryptoSubtle: C ? typeof C.subtle : "absent",
    cryptoGetRandomValues: C ? typeof C.getRandomValues : "absent",
    wxGetRandomValues: typeof wx !== "undefined" ? typeof wx.getRandomValues : "absent",
  };
}

function now() {
  const p = typeof performance === "undefined" ? null : performance;
  return p && typeof p.now === "function" ? p.now() : Date.now();
}

function round1(ms) {
  return Math.round(ms * 10) / 10;
}

function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf && buf.buffer) return new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
  return new Uint8Array(0);
}

// Exact-size ArrayBuffer for Module() input — fresh Uint8Array from xorCrypt
// already has byteOffset 0 so .buffer is exact; view-derived slices normalize.
function toAB(u8) {
  if (u8.byteOffset === 0 && u8.buffer.byteLength === u8.byteLength) return u8.buffer;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function wxFetchBytes(url) {
  return new Promise((resolve, reject) => {
    const t0 = now();
    httpOps += 1;
    wx.request({
      url,
      method: "GET",
      responseType: "arraybuffer",
      success: (res) => {
        if (res.statusCode === 200) {
          const bytes = toU8(res.data);
          httpBytes += bytes.byteLength;
          resolve({ bytes, ms: now() - t0 });
        } else {
          reject(new Error(`http ${res.statusCode}`));
        }
      },
      fail: (e) => reject(new Error(`wx.request fail: ${(e && e.errMsg) || JSON.stringify(e)}`)),
    });
  });
}

function wxFetchText(url) {
  return new Promise((resolve, reject) => {
    httpOps += 1;
    wx.request({
      url,
      method: "GET",
      success: (res) => {
        if (res.statusCode === 200) resolve({ text: String(res.data) });
        else reject(new Error(`http ${res.statusCode}`));
      },
      fail: (e) => reject(new Error(`wx.request fail: ${(e && e.errMsg) || JSON.stringify(e)}`)),
    });
  });
}

function errName(e) {
  return e && e.name ? String(e.name) : "Error";
}

function armError(e) {
  return { ok: false, error: String((e && e.message) || e), errorName: errName(e) };
}

function wxAvailable() {
  return typeof WXWebAssembly !== "undefined" && typeof WXWebAssembly.Module === "function";
}

async function armCryptoProbe() {
  const C = typeof crypto === "undefined" ? null : crypto;
  if (!C || !C.subtle || typeof C.subtle.encrypt !== "function") {
    return { ok: true, subtle: "absent" };
  }
  try {
    const n = 4 * 1024 * 1024;
    const key = await C.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const iv = new Uint8Array(12);
    const data = new Uint8Array(n);
    let t = now();
    const ct = await C.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const encryptMs = round1(now() - t);
    t = now();
    await C.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const decryptMs = round1(now() - t);
    return { ok: true, subtle: "present", bytes: n, encryptMs4MB: encryptMs, decryptMs4MB: decryptMs };
  } catch (e) {
    return { ...armError(e), subtle: "present-but-failed" };
  }
}

async function armPathBaseline() {
  if (typeof WXWebAssembly === "undefined" || typeof WXWebAssembly.instantiate !== "function") {
    return { ok: false, error: "WXWebAssembly.instantiate unavailable" };
  }
  const t0 = now();
  try {
    const r = await WXWebAssembly.instantiate("wasm/echo.wasm");
    const inst = r && r.instance ? r.instance : r;
    const value = inst.exports.echo();
    return { ok: value === 42, value, totalMs: round1(now() - t0) };
  } catch (e) {
    return armError(e);
  }
}

async function armBytesRaw(base) {
  if (!wxAvailable()) return { ok: false, error: "WXWebAssembly.Module unavailable" };
  if (!base) return { ok: false, skipped: "no baseUrl" };
  try {
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const fetchMs = round1(res.ms);
    const ab = toAB(res.bytes);
    // P-bytes-bad arm 1: garbage must throw at Module
    let badModuleThrew = false;
    let badModuleName = null;
    try {
      new WXWebAssembly.Module(toAB(new Uint8Array([0, 1, 2, 3, 4, 5])));
    } catch (e) {
      badModuleThrew = true;
      badModuleName = errName(e);
    }
    // P-bytes-bad arm 2: bad.wasm compiles, Instance must throw LinkError
    let badLinkThrew = false;
    let badLinkName = null;
    try {
      const badRes = await wxFetchBytes(`${base}/bad.wasm`);
      const badMod = new WXWebAssembly.Module(toAB(badRes.bytes));
      try {
        new WXWebAssembly.Instance(badMod, {});
      } catch (e) {
        badLinkThrew = true;
        badLinkName = errName(e);
      }
    } catch (e) {
      return {
        ...armError(e),
        fetchMs,
        value: null,
        badModuleThrew,
        badModuleName,
        badLinkThrew,
        badLinkName,
        moduleFromView: false,
      };
    }
    // main: Module from ArrayBuffer
    let t = now();
    const mod = new WXWebAssembly.Module(ab);
    const compileMs = round1(now() - t);
    // acceptance fact: Module from Uint8Array view
    let moduleFromView = false;
    let moduleFromViewErr = null;
    try {
      new WXWebAssembly.Module(res.bytes);
      moduleFromView = true;
    } catch (e) {
      moduleFromViewErr = errName(e);
    }
    t = now();
    const inst = new WXWebAssembly.Instance(mod, {});
    const linkMs = round1(now() - t);
    const value = inst.exports.echo();
    const introspect = (kind) => {
      try {
        return typeof WXWebAssembly.Module[kind] === "function"
          ? WXWebAssembly.Module[kind](mod).length
          : null;
      } catch {
        return null;
      }
    };
    return {
      ok: value === 42 && badModuleThrew && badLinkThrew,
      value,
      fetchMs,
      compileMs,
      linkMs,
      totalMs: round1(fetchMs + compileMs + linkMs),
      plainBytes: res.bytes.length,
      badModuleThrew,
      badModuleName,
      badLinkThrew,
      badLinkName,
      moduleFromView,
      moduleFromViewErr,
      moduleImports: introspect("imports"),
      moduleExports: introspect("exports"),
    };
  } catch (e) {
    return armError(e);
  }
}

// Exploratory arm (post-F-02 finding): Module(bytes) was RED at S1 — the ctor
// is path-typed ("only support file type .wasm or .wasm.br"). Probe every
// plausible byte-capable entry so the receipt records whether ANY bytes
// instantiation path exists. Informational: sub-results are facts, the arm's
// own ok is always true.
async function armAltEntries(base) {
  const out = { ok: true };
  const tryStep = async (key, fn) => {
    try {
      out[key] = await fn();
      out[key].ok = true;
    } catch (e) {
      out[key] = { ok: false, errorName: errName(e), error: String((e && e.message) || e) };
    }
  };
  if (typeof WXWebAssembly === "undefined") {
    return { ok: true, skipped: "WXWebAssembly unavailable" };
  }
  // (a) Module(path string) — is the ctor file-based rather than byte-based?
  await tryStep("moduleFromPath", async () => {
    const m = new WXWebAssembly.Module("wasm/echo.wasm");
    const inst = new WXWebAssembly.Instance(m, {});
    return { value: inst.exports.echo() };
  });
  // (b) compile(ArrayBuffer) — async byte entry (exists per apiSurface, absent
  // from typings)? resolve either sync or Promise return shape.
  await tryStep("compileBytes", async () => {
    if (typeof WXWebAssembly.compile !== "function") return { absent: true };
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const maybe = WXWebAssembly.compile(toAB(res.bytes));
    const mod = maybe && typeof maybe.then === "function" ? await maybe : maybe;
    const inst = new WXWebAssembly.Instance(mod, {});
    return { async: !!(maybe && typeof maybe.then === "function"), value: inst.exports.echo() };
  });
  // (c) compile(path string)?
  await tryStep("compilePath", async () => {
    if (typeof WXWebAssembly.compile !== "function") return { absent: true };
    const maybe = WXWebAssembly.compile("wasm/echo.wasm");
    const mod = maybe && typeof maybe.then === "function" ? await maybe : maybe;
    const inst = new WXWebAssembly.Instance(mod, {});
    return { async: !!(maybe && typeof maybe.then === "function"), value: inst.exports.echo() };
  });
  // (d) instantiate(ArrayBuffer) — typings say path-only; verify empirically.
  await tryStep("instantiateBytes", async () => {
    if (typeof WXWebAssembly.instantiate !== "function") return { absent: true };
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const r = await WXWebAssembly.instantiate(toAB(res.bytes));
    const inst = r && r.instance ? r.instance : r;
    return { value: inst.exports.echo() };
  });
  // (e) Module(Uint8Array view) — already covered by bytesRaw.moduleFromView;
  // repeat here only as a compact fact if the bytes arm was filtered out.
  await tryStep("moduleFromView", async () => {
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const m = new WXWebAssembly.Module(res.bytes);
    const inst = new WXWebAssembly.Instance(m, {});
    return { value: inst.exports.echo() };
  });
  // (f) THE rescue path: write decrypted bytes to a tmp file via
  // FileSystemManager, then instantiate by path. If this works the
  // encrypted-delivery premise survives as "tmp-file transient" rather than
  // "pure memory" — plaintext transits local fs but never ships in package.
  await tryStep("moduleFromTmpFile", async () => {
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const fsm = wx.getFileSystemManager();
    const p = `${wx.env.USER_DATA_PATH}/spike-echo.wasm`;
    fsm.writeFileSync(p, toAB(res.bytes));
    const m = new WXWebAssembly.Module(p);
    const inst = new WXWebAssembly.Instance(m, {});
    return { value: inst.exports.echo(), path: p };
  });
  await tryStep("instantiateTmpFile", async () => {
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const fsm = wx.getFileSystemManager();
    const p = `${wx.env.USER_DATA_PATH}/spike-echo2.wasm`;
    fsm.writeFileSync(p, toAB(res.bytes));
    const r = await WXWebAssembly.instantiate(p);
    const inst = r && r.instance ? r.instance : r;
    return { value: inst.exports.echo(), path: p };
  });
  await tryStep("moduleFromUsrScheme", async () => {
    const res = await wxFetchBytes(`${base}/echo.wasm`);
    const fsm = wx.getFileSystemManager();
    const p = `${wx.env.USER_DATA_PATH}/spike-echo3.wasm`;
    fsm.writeFileSync(p, toAB(res.bytes));
    const m = new WXWebAssembly.Module("usr://spike-echo3.wasm");
    const inst = new WXWebAssembly.Instance(m, {});
    return { value: inst.exports.echo() };
  });
  return out;
}

async function armEncPipeline(base) {
  if (!wxAvailable()) return { ok: false, error: "WXWebAssembly.Module unavailable" };
  if (!base) return { ok: false, skipped: "no baseUrl" };
  try {
    const enc = await wxFetchBytes(`${base}/echo.enc`);
    const t0 = now();
    const plain = xorCrypt(enc.bytes, "echo");
    const decryptMs = round1(now() - t0);
    // integrity: decrypted bytes must equal the served raw wasm
    const raw = await wxFetchBytes(`${base}/echo.wasm`);
    let roundtripEq = plain.length === raw.bytes.length;
    if (roundtripEq) {
      for (let i = 0; i < plain.length; i++) {
        if (plain[i] !== raw.bytes[i]) {
          roundtripEq = false;
          break;
        }
      }
    }
    let t = now();
    const mod = new WXWebAssembly.Module(toAB(plain));
    const compileMs = round1(now() - t);
    t = now();
    const inst = new WXWebAssembly.Instance(mod, {});
    const linkMs = round1(now() - t);
    const value = inst.exports.echo();
    // P-wrong-key: wrong-label ciphertext decrypted with the correct label —
    // must be rejected by Module for a content reason (records error name).
    const badKey = await wxFetchBytes(`${base}/echo.enc?key=bad`);
    const badPlain = xorCrypt(badKey.bytes, "echo");
    let wrongKeyThrew = false;
    let wrongKeyName = null;
    try {
      new WXWebAssembly.Module(toAB(badPlain));
    } catch (e) {
      wrongKeyThrew = true;
      wrongKeyName = errName(e);
    }
    // P-trunc-wasm: truncated ciphertext must fail Module
    const trunc = await wxFetchBytes(`${base}/echo.enc?trunc=half`);
    const truncPlain = xorCrypt(trunc.bytes, "echo");
    let truncThrew = false;
    let truncName = null;
    try {
      new WXWebAssembly.Module(toAB(truncPlain));
    } catch (e) {
      truncThrew = true;
      truncName = errName(e);
    }
    // P-valid-swap: ciphertext of a VALID but wrong module (evil: echo()=7)
    // — engine validation must NOT reject it, proving Module checks format,
    // not integrity. If the engine rejects it, that itself is a finding.
    let validSwapModuleOk = false;
    let validSwapValue = null;
    let validSwapName = null;
    try {
      const evil = await wxFetchBytes(`${base}/evil.enc`);
      const evilPlain = xorCrypt(evil.bytes, "echo");
      const evilMod = new WXWebAssembly.Module(toAB(evilPlain));
      validSwapModuleOk = true;
      const evilInst = new WXWebAssembly.Instance(evilMod, {});
      validSwapValue = evilInst.exports.echo();
    } catch (e) {
      validSwapName = errName(e);
    }
    const validSwapNotRejected = validSwapModuleOk === true && validSwapValue !== 42;
    return {
      ok: value === 42 && roundtripEq && wrongKeyThrew && truncThrew && validSwapNotRejected,
      value,
      fetchMs: round1(enc.ms),
      decryptMs,
      compileMs,
      linkMs,
      totalMs: round1(enc.ms + decryptMs + compileMs + linkMs),
      plainBytes: plain.length,
      roundtripEq,
      wrongKeyThrew,
      wrongKeyName,
      truncThrew,
      truncName,
      validSwapModuleOk,
      validSwapValue,
      validSwapName,
      validSwapNotRejected,
    };
  } catch (e) {
    return armError(e);
  }
}

function buildStubImports(imports) {
  const stub = { calls: 0 };
  const obj = {};
  const kinds = {};
  for (const d of imports) {
    kinds[d.kind] = (kinds[d.kind] || 0) + 1;
    const m = (obj[d.module] = obj[d.module] || {});
    if (d.kind === "function") {
      m[d.name] = () => {
        stub.calls += 1;
        return 0;
      };
    } else if (d.kind === "memory") {
      m[d.name] = new WXWebAssembly.Memory({ initial: 1 });
    } else if (d.kind === "table") {
      m[d.name] = new WXWebAssembly.Table({ element: "anyfunc", initial: 1 });
    } else {
      m[d.name] = 0;
    }
  }
  return { obj, kinds, stub };
}

async function armFxReal(base) {
  if (!wxAvailable()) return { ok: false, error: "WXWebAssembly.Module unavailable" };
  if (!base) return { ok: false, skipped: "no baseUrl" };
  try {
    const enc = await wxFetchBytes(`${base}/fx-core-async.enc`);
    const fetchMs = round1(enc.ms);
    const t0 = now();
    const plain = xorCrypt(enc.bytes, "fx-core-async");
    const decryptMs = round1(now() - t0);
    // byte-level integrity: server-published FNV-1a of the raw wasm vs local
    // checksum of decrypted plaintext (engine-check parity, not a MAC).
    let fnvExpected = null;
    let fnvActual = null;
    let fnvMatch = null;
    try {
      const fr = await wxFetchText(`${base}/fx-core-async.fnv`);
      fnvExpected = fr.text.trim();
      fnvActual = fnv1a32(plain);
      fnvMatch = fnvExpected === fnvActual;
    } catch (e) {
      fnvMatch = null; // endpoint failure -> recorded as unverified, not failed
    }
    // stage 1: compile (Module constructor wall clock)
    let mod = null;
    let moduleOk = false;
    let compileErr = null;
    let compileErrName = null;
    const t1 = now();
    try {
      mod = new WXWebAssembly.Module(toAB(plain));
      moduleOk = true;
    } catch (e) {
      compileErr = String((e && e.message) || e);
      compileErrName = errName(e);
    }
    const compileMs = round1(now() - t1);
    if (!mod) {
      return {
        ok: false,
        moduleOk,
        compileErr,
        compileErrName,
        fetchMs,
        decryptMs,
        compileMs,
        plainBytes: plain.length,
        fnvExpected,
        fnvActual,
        fnvMatch,
      };
    }
    // stage 2: introspection (may be absent -> recorded, not fatal at probe level)
    let importDescs = [];
    let exportDescs = [];
    let introspectErr = null;
    try {
      importDescs =
        typeof WXWebAssembly.Module.imports === "function" ? WXWebAssembly.Module.imports(mod) : [];
      exportDescs =
        typeof WXWebAssembly.Module.exports === "function" ? WXWebAssembly.Module.exports(mod) : [];
    } catch (e) {
      introspectErr = `${errName(e)}: ${String((e && e.message) || e)}`;
    }
    // stage 3: stub importObject
    let stubObj = {};
    let importKinds = {};
    let stub = { calls: 0 };
    let stubErr = null;
    try {
      const built = buildStubImports(importDescs);
      stubObj = built.obj;
      importKinds = built.kinds;
      stub = built.stub;
    } catch (e) {
      stubErr = `${errName(e)}: ${String((e && e.message) || e)}`;
    }
    // stage 4: link (Instance) — stubs must never be called (P-stub-quiet)
    const t2 = now();
    let instanceOk = false;
    let linkErr = null;
    let linkErrName = null;
    try {
      const inst = new WXWebAssembly.Instance(mod, stubObj);
      instanceOk = !!(
        inst.exports &&
        inst.exports.memory &&
        typeof inst.exports[ASYNCIFY_STATE_EXPORT] === "function"
      );
    } catch (e) {
      linkErr = String((e && e.message) || e);
      linkErrName = errName(e);
    }
    const linkMs = round1(now() - t2);
    const hasMemory = exportDescs.some((e) => e.kind === "memory");
    const hasStart = exportDescs.some((e) => e.name === "_start");
    const hasAsyncify = exportDescs.some((e) => e.name === ASYNCIFY_STATE_EXPORT);
    const ok =
      moduleOk === true &&
      instanceOk === true &&
      stub.calls === 0 &&
      hasMemory === true &&
      hasAsyncify === true &&
      fnvMatch === true;
    return {
      ok,
      moduleOk,
      compileErr,
      compileErrName,
      introspectErr,
      stubErr,
      instanceOk,
      linkErr,
      linkErrName,
      imports: importDescs.length,
      importKinds,
      hasMemory,
      hasStart,
      hasAsyncify,
      fetchMs,
      decryptMs,
      compileMs,
      linkMs,
      totalMs: round1(fetchMs + decryptMs + compileMs + linkMs),
      plainBytes: plain.length,
      stubCalls: stub.calls,
      fnvExpected,
      fnvActual,
      fnvMatch,
    };
  } catch (e) {
    return { ...armError(e), moduleOk: false };
  }
}

async function runAllProbes(base, stage, arms, flush) {
  const selected = arms && arms.length ? arms : ALL_ARMS;
  httpOps = 0;
  httpBytes = 0;
  const report = {
    apiSurface: apiSurface(),
    baseHost: base ? String(base).replace(/^https?:\/\//, "").split("/")[0] : null,
    arms: selected,
  };
  const emit = flush || (() => {});
  emit(report);
  const run = async (name, fn) => {
    if (!selected.includes(name)) {
      report[name] = { skipped: "arm filter" };
      emit(report);
      return;
    }
    if (stage) stage(name);
    const t = now();
    report[name] = await fn();
    report[name].armWallMs = round1(now() - t);
    emit(report);
  };
  const withBase = (fn) => () => fn(base);
  await run("cryptoProbe", armCryptoProbe);
  await run("pathBaseline", armPathBaseline);
  await run("bytesRaw", withBase(armBytesRaw));
  await run("altEntries", withBase(armAltEntries));
  await run("encPipeline", withBase(armEncPipeline));
  await run("fxReal", withBase(armFxReal));
  report.stats = { httpOps, httpBytes };
  emit(report);
  return report;
}

module.exports = { runAllProbes, ALL_ARMS };
