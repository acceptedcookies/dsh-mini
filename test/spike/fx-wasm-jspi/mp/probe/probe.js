// Probe implementation for the sim/device lanes.
// Asyncify driver below mirrors test/spike/fx-wasm-jspi/lib/asyncify.mjs —
// keep the two in sync; divergence is itself a finding (charter §3.3).
// Buffer init contract: *(DATA)=DATA+8 stack cursor, *(DATA+4)=region end;
// all four asyncify runtime fns trap `unreachable` if *DATA > *(DATA+4).

const ASYNCIFY_DATA_ADDR = 16;
const ASYNCIFY_STACK_END = 1024;

function apiSurface() {
  const w = typeof WXWebAssembly === "undefined" ? null : WXWebAssembly;
  const s = typeof WebAssembly === "undefined" ? null : WebAssembly;
  return {
    wxWasm: typeof WXWebAssembly,
    wxWasmSuspending: w ? typeof w.Suspending : "absent",
    wxWasmPromising: w ? typeof w.promising : "absent",
    stdWasm: typeof WebAssembly,
    stdWasmSuspending: s ? typeof s.Suspending : "absent",
    stdWasmPromising: s ? typeof s.promising : "absent",
  };
}

async function runEcho() {
  try {
    const { instance: inst } = await WXWebAssembly.instantiate("wasm/echo.wasm");
    const value = inst.exports.echo();
    return { ok: value === 42, value };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function runBad() {
  try {
    await WXWebAssembly.instantiate("wasm/bad.wasm", {});
    return { threw: false };
  } catch (e) {
    return { threw: true, name: e && e.name ? String(e.name) : null };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAsyncToy() {
  try {
    const ref = { exports: null };
    const wrapped = {};
    const seq = [7, 35];
    let suspends = 0;
    let calls = 0;
    wrapped.host_read = () => {
      const exports = ref.exports;
      if (exports.asyncify_get_state() === 2) {
        exports.asyncify_stop_rewind();
        return wrapped.replayValue;
      }
      const value = seq[calls];
      wrapped.pending = sleep(5).then(() => value);
      exports.asyncify_start_unwind(ASYNCIFY_DATA_ADDR);
      suspends += 1;
      return 0;
    };
    const { instance: inst } = await WXWebAssembly.instantiate("wasm/async-toy.wasm", { env: wrapped });
    ref.exports = inst.exports;
    const exports = inst.exports;
    const view = new Int32Array(exports.memory.buffer);
    view[ASYNCIFY_DATA_ADDR >> 2] = ASYNCIFY_DATA_ADDR + 8;
    view[(ASYNCIFY_DATA_ADDR + 4) >> 2] = ASYNCIFY_STACK_END;
    let sum = exports.run();
    while (exports.asyncify_get_state() === 1) {
      exports.asyncify_stop_unwind();
      calls += 1;
      wrapped.replayValue = await wrapped.pending;
      exports.asyncify_start_rewind(ASYNCIFY_DATA_ADDR);
      sum = exports.run();
    }
    const memCalls = new Int32Array(exports.memory.buffer)[0];
    return {
      ok: sum === 42 && memCalls === 2 && suspends === 2,
      sum,
      calls: memCalls,
      suspends,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function runAllProbes(stage) {
  const report = { apiSurface: apiSurface() };
  if (stage) stage("echo");
  report.echo = await runEcho();
  if (stage) stage("bad");
  report.bad = await runBad();
  if (stage) stage("asyncToy");
  report.asyncToy = await runAsyncToy();
  return report;
}

module.exports = { runAllProbes };
