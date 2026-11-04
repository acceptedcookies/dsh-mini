// JW-S2 — DevTools 模拟器内 Asyncify toy (V-J4)
import { join } from "node:path";
import { existsSync } from "node:fs";
import { launchSpikeMp, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const mpDir = join(spikeDir, "mp");
  if (!existsSync(join(mpDir, "wasm", "async-toy.wasm"))) {
    return {
      verdict: "NOT_RUN",
      reason: "mp/wasm artifacts missing; run `node harness/run.mjs --build` first",
    };
  }
  let miniProgram;
  try {
    miniProgram = await launchSpikeMp(mpDir);
  } catch (e) {
    return {
      verdict: "NOT_RUN",
      reason: `automator launch failed: ${(e && e.message) || e}`,
    };
  }
  try {
    const device = await deviceInfo(miniProgram);
    const result = await grabProbeResult(miniProgram);
    if (!result || result.fatal) {
      return { verdict: "RED", reason: result?.fatal ? `probe fatal: ${result.fatal}` : "no probe result within 30s", device };
    }
    const t = result.asyncToy;
    const plants = [
      {
        id: "P-async-sync",
        fired: t.suspends === 2 && t.calls === 2,
        restored: true,
      },
    ];
    const ok = t.ok === true && t.sum === 42 && t.calls === 2 && t.suspends === 2;
    if (!ok) {
      return {
        verdict: "RED",
        reason: `asyncify toy failed in simulator: ${t.error || `sum=${t.sum} calls=${t.calls} suspends=${t.suspends}`}`,
        counts: { sum: t.sum ?? null, calls: t.calls ?? null, suspends: t.suspends ?? null },
        plants,
        device,
      };
    }
    return {
      verdict: "PASS",
      reason: "asyncified wasm suspended/resumed twice inside WXWebAssembly with correct state",
      counts: { sum: t.sum, calls: t.calls, suspends: t.suspends },
      plants,
      device,
    };
  } finally {
    await closeMp(miniProgram);
  }
}
