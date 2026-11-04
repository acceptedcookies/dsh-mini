// AG-S1 — DevTools 模拟器：分包 fx-core-async.wasm 真实文本 turn。
import { driveSim } from "../lib/sim.mjs";

export async function run({ spikeDir }) {
  const t0 = Date.now();
  const { fxTest, device } = await driveSim(spikeDir, "send");
  if (!fxTest) return { verdict: "RED", reason: "fxTest 未出现（探针未回报）" };
  const text = fxTest.text || "";
  const checks = {
    phaseDone: fxTest.phase === "done",
    sessionIssued: typeof fxTest.sessionId === "string" && fxTest.sessionId.length >= 6,
    stopEndTurn: fxTest.stopReason === "end_turn",
    textOk: /\bok\b/i.test(text) && text.length < 64,
    updatesStreamed: fxTest.updates >= 1,
    subpackagePath: fxTest.wasmPath === undefined || String(fxTest.wasmPath).startsWith("subpkg/"),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    verdict: failed.length ? "RED" : "PASS",
    reason: failed.length ? `failed: ${failed.join(",")} (${fxTest.error || fxTest.phase})` : "模拟器内分包 wasm 完成真实文本 turn",
    device,
    counts: { updates: fxTest.updates, toolCalls: fxTest.toolCalls?.length ?? 0 },
    timing: { diagnostic: { totalMs: Date.now() - t0 } },
    remoteOps: 1,
    detail: { phase: fxTest.phase, sessionId: fxTest.sessionId, text: text.slice(0, 200), error: fxTest.error ?? null },
  };
}
