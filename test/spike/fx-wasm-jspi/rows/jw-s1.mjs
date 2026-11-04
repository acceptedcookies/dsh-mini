// JW-S1 — DevTools 模拟器: API 面 + echo 控制臂 (V-J1, V-J2)
import { join } from "node:path";
import { launchSpikeMp, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";
import { assertProbeResultShape, assertApiSurfaceShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const mpDir = join(spikeDir, "mp");
  let miniProgram;
  try {
    miniProgram = await launchSpikeMp(mpDir);
  } catch (e) {
    return {
      verdict: "NOT_RUN",
      reason: `automator launch failed: ${(e && e.message) || e}`,
      detail: { hint: "devtools service port may be disabled or first-run dialog pending" },
    };
  }
  try {
    const device = await deviceInfo(miniProgram);
    const result = await grabProbeResult(miniProgram);
    if (!result) {
      return { verdict: "RED", reason: "probe page produced no result within 30s", device };
    }
    if (result.fatal) {
      return { verdict: "RED", reason: `probe page fatal: ${result.fatal}`, device };
    }
    const shapeErr = assertProbeResultShape(result);
    if (shapeErr) {
      return { verdict: "RED", reason: `probe result shape invalid: ${shapeErr}`, device };
    }
    const plants = [];
    // P-jspi-null: an always-green JSPI claim is falsified iff sim lacks the API.
    plants.push({
      id: "P-jspi-null",
      fired: result.apiSurface.wxWasmSuspending !== "function",
      restored: true,
    });
    // P-wasm-bad: bad module must have thrown inside the page.
    plants.push({ id: "P-wasm-bad", fired: result.bad.threw === true, restored: true });

    const checks = {
      wxWasmPresent: result.apiSurface.wxWasm === "object" || result.apiSurface.wxWasm === "function",
      echoOk: result.echo.ok === true && result.echo.value === 42,
      badThrew: result.bad.threw === true,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    const jspiPresent =
      result.apiSurface.wxWasmSuspending === "function" &&
      result.apiSurface.wxWasmPromising === "function";
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `checks failed: ${failed.join(",")}`,
        counts: { jspiPresent: jspiPresent ? 1 : 0 },
        plants,
        device,
        detail: { apiSurface: result.apiSurface, echo: result.echo, bad: result.bad },
      };
    }
    return {
      verdict: "PASS",
      reason: jspiPresent
        ? "simulator exposes JSPI — fx wasm may run unmodified (fact only; device lanes still open)"
        : "simulator lacks JSPI; wasm pipeline itself works (echo 42, bad rejected)",
      counts: { jspiPresent: jspiPresent ? 1 : 0 },
      plants,
      device,
      detail: { apiSurface: result.apiSurface, echo: result.echo, bad: result.bad },
    };
  } finally {
    await closeMp(miniProgram);
  }
}
