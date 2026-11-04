// AG-S2 — DevTools 模拟器：真实 tool-call 循环（fx_host_tool_call 挂起 import）。
import { driveSim } from "../lib/sim.mjs";

const TOOL_PROMPT = "What is the weather in Tokyo right now? You must call the get_weather tool, then answer briefly.";

export async function run({ spikeDir }) {
  const t0 = Date.now();
  const { fxTest, device } = await driveSim(spikeDir, "send", { prompt: TOOL_PROMPT });
  if (!fxTest) return { verdict: "RED", reason: "fxTest 未出现（探针未回报）" };
  const calls = fxTest.toolCalls || [];
  const text = fxTest.text || "";
  const checks = {
    phaseDone: fxTest.phase === "done",
    stopEndTurn: fxTest.stopReason === "end_turn",
    toolExecuted: calls.some((c) => c.name === "get_weather" && c.input?.city === "Tokyo"),
    fixtureInAnswer: text.includes("22") && /sunny/i.test(text),
    toolUpdatesSeen: fxTest.updates >= 10,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    verdict: failed.length ? "RED" : "PASS",
    reason: failed.length ? `failed: ${failed.join(",")} (${fxTest.error || fxTest.phase})` : "模拟器内完整 tool-call 循环成立",
    device,
    counts: { updates: fxTest.updates, toolCalls: calls.length },
    timing: { diagnostic: { totalMs: Date.now() - t0 } },
    remoteOps: 1,
    detail: { phase: fxTest.phase, text: text.slice(0, 200), toolCalls: calls, error: fxTest.error ?? null },
  };
}
