// AB-R1 — iOS 真机全臂 (V-A1/V-A2/V-A3/V-A5；V-A4 机会项)
// 需要 [业主] iOS 真机 + 预览安装授权 + LAN mock 点收：
//   node lib/wasm-server.mjs --dir <spike>/fixtures --lan --evidence <spike>/evidence/device
// 页面输入打印的 LAN URL → 全臂跑完自动 POST /report 落盘（剪贴板兜底）→
// SPIKE_RESULT_JSON 指向落盘文件 + SPIKE_DEVICE_* 提供设备事实。
import { readFileSync, existsSync } from "node:fs";
import { assertProbeResultShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const resultPath = process.env.SPIKE_RESULT_JSON;
  if (!resultPath || !existsSync(resultPath)) {
    return {
      verdict: "NOT_RUN",
      reason: "device evidence missing; run the probe page on device (POST /report lands under evidence/device/) then set SPIKE_RESULT_JSON to that file",
    };
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const shapeErr = assertProbeResultShape(result);
  if (shapeErr) {
    return { verdict: "RED", reason: `device probe result shape invalid: ${shapeErr}` };
  }
  const s = result.apiSurface;
  const e = result.encPipeline ?? {};
  const b = result.bytesRaw ?? {};
  const f = result.fxReal ?? {};
  const stats = result.stats ?? {};
  const plants = [
    { id: "P-bytes-bad", fired: b.badModuleThrew === true && b.badLinkThrew === true, restored: b.ok === true },
    { id: "P-wrong-key", fired: e.wrongKeyThrew === true, restored: e.ok === true },
    { id: "P-trunc-wasm", fired: e.truncThrew === true, restored: e.ok === true },
    { id: "P-valid-swap", fired: e.validSwapNotRejected === true, restored: e.ok === true },
    { id: "P-transform-roundtrip", fired: e.roundtripEq === true, restored: e.ok === true },
    { id: "P-stub-quiet", fired: f.stubCalls === 0 && f.instanceOk === true, restored: f.moduleOk === true },
  ];
  const checks = {
    moduleCtor: s.wxWasmModule === "function",
    instanceCtor: s.wxWasmInstance === "function",
    memoryCtor: s.wxWasmMemory === "function",
    tableCtor: s.wxWasmTable === "function",
    moduleImportsFn: s.wxWasmModuleImports === "function",
    moduleExportsFn: s.wxWasmModuleExports === "function",
    moduleCustomSectionsFn: s.wxWasmModuleCustomSections === "function",
    pathOk: result.pathBaseline?.ok === true && result.pathBaseline?.value === 42,
    bytesOk: b.ok === true && b.value === 42,
    moduleFromView: b.moduleFromView === true,
    badLinkThrew: b.badLinkThrew === true,
    encOk: e.ok === true && e.value === 42,
    roundtripEq: e.roundtripEq === true,
    wrongKeyThrew: e.wrongKeyThrew === true,
    truncThrew: e.truncThrew === true,
    validSwapNotRejected: e.validSwapNotRejected === true,
    // byte provenance: bytes must have come from an http mock endpoint,
    // not the package — baseHost is recorded by the probe itself
    fromHttpMock: typeof result.baseHost === "string" && result.baseHost.length > 0,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const fxEvidenced = f.moduleOk === true && f.instanceOk === true && f.stubCalls === 0;
  const budgetUsed = { objects: 6, ops: stats.httpOps ?? null, bytes: stats.httpBytes ?? null };
  if (failed.length) {
    return {
      verdict: "RED",
      reason: `device checks failed: ${failed.join(",")}`,
      counts: { fxReal: fxEvidenced ? 1 : 0 },
      plants,
      budgetUsed,
      detail: result,
    };
  }
  return {
    verdict: "PASS",
    reason: fxEvidenced
      ? "iOS device: full byte pipeline verified incl. real-size fx wasm compile+link arm (fnv-verified)"
      : "iOS device: core byte pipeline verified; fxReal arm not evidenced (fixture not served on device lane) — V-A4 device-level pending",
    counts: { fxReal: fxEvidenced ? 1 : 0 },
    plants,
    budgetUsed,
    detail: { cryptoProbe: result.cryptoProbe, fxReal: f, timings: { encTotalMs: e.totalMs ?? null, fxTotalMs: f.totalMs ?? null }, baseHost: result.baseHost },
  };
}
