// JW-R1 — iOS 真机全套探针 (V-J1, V-J2, V-J5)
// 需要 [业主] 提供 iOS 真机并以真机预览/真机调试方式打开 mp/ 工程；
// SPIKE_DEVICE_MODEL / SPIKE_DEVICE_OS / SPIKE_DEVICE_WECHAT / SPIKE_DEVICE_BASELIB
// 提供设备事实进 receipt；结果由页面上报的 JSON 或人工抄录进 SPIKE_RESULT_JSON。
import { readFileSync, existsSync } from "node:fs";

export async function run(ctx) {
  const resultPath = process.env.SPIKE_RESULT_JSON;
  if (!resultPath || !existsSync(resultPath)) {
    return {
      verdict: "NOT_RUN",
      reason: "device evidence channel missing; set SPIKE_RESULT_JSON to the probe result JSON captured from the device",
    };
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const t = result.asyncToy ?? {};
  const surface = result.apiSurface ?? {};
  const jspiPresent =
    surface.wxWasmSuspending === "function" && surface.wxWasmPromising === "function";
  const checks = {
    wxWasmPresent: surface.wxWasm === "object" || surface.wxWasm === "function",
    echoOk: result.echo?.ok === true && result.echo?.value === 42,
    badThrew: result.bad?.threw === true,
    asyncToyOk: t.ok === true && t.sum === 42 && t.calls === 2 && t.suspends === 2,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const plants = [
    { id: "P-jspi-null", fired: !jspiPresent, restored: true },
    { id: "P-wasm-bad", fired: result.bad?.threw === true, restored: true },
    { id: "P-async-sync", fired: t.suspends === 2 && t.calls === 2, restored: true },
  ];
  if (failed.length) {
    return {
      verdict: "RED",
      reason: `device checks failed: ${failed.join(",")}`,
      counts: { jspiPresent: jspiPresent ? 1 : 0 },
      plants,
      detail: result,
    };
  }
  return {
    verdict: "PASS",
    reason: jspiPresent
      ? "iOS device exposes JSPI (surprising — record and verify)"
      : "iOS device lacks JSPI; asyncify path verified end-to-end on device",
    counts: { jspiPresent: jspiPresent ? 1 : 0 },
    plants,
    detail: result,
  };
}
