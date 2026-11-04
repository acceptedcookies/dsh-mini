// ST-S1 — DevTools wx.request chunked 承载 (V-T3)
import { join } from "node:path";
import { startMockSse } from "../lib/sse-server.mjs";
import { launchSpikeMp, setTargetUrl, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";
import { expectedDeltas } from "../fixtures/corpus.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const mpDir = join(spikeDir, "mp");
  const mock = await startMockSse({ delayMs: 60 });
  let miniProgram;
  try {
    try {
      miniProgram = await launchSpikeMp(mpDir);
    } catch (e) {
      return {
        verdict: "NOT_RUN",
        reason: `automator launch failed: ${(e && e.message) || e}`,
      };
    }
    const device = await deviceInfo(miniProgram);
    await setTargetUrl(miniProgram, mock.url);
    const result = await grabProbeResult(miniProgram, { timeoutMs: 40_000 });
    if (!result) {
      return { verdict: "RED", reason: "no probe result within 40s", device };
    }
    const expected = expectedDeltas();
    const checks = {
      chunksGe2: result.chunks >= 2,
      eventsComplete:
        Array.isArray(result.events) &&
        JSON.stringify(result.deltas) === JSON.stringify(expected) &&
        result.sawDone === true,
      noError: !result.error,
      noAbort: result.aborted !== true,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `sim checks failed: ${failed.join(",")} (${result.error || ""})`,
        counts: { chunks: result.chunks, events: result.events?.length ?? 0 },
        device,
        detail: result,
      };
    }
    return {
      verdict: "PASS",
      reason: "wx.request carried the full SSE corpus in >=2 independent chunks inside the simulator",
      counts: {
        chunks: result.chunks,
        events: result.events.length,
        deltas: result.deltas.length,
        chunkBytes: result.chunkBytes.reduce((a, b) => a + b, 0),
      },
      device,
      detail: { chunkBytes: result.chunkBytes },
    };
  } finally {
    await closeMp(miniProgram);
    await mock.close();
  }
}
