// ST-R1 — iOS 真机 (V-T5)。证据通道: SPIKE_RESULT_JSON = 设备侧 probe 结果 JSON。
import { readFileSync, existsSync } from "node:fs";
import { expectedDeltas } from "../fixtures/corpus.mjs";

export async function run(ctx) {
  const resultPath = process.env.SPIKE_RESULT_JSON;
  if (!resultPath || !existsSync(resultPath)) {
    return {
      verdict: "NOT_RUN",
      reason: "device evidence channel missing; set SPIKE_RESULT_JSON to the probe result JSON captured from the device (LAN mock requires owner sign-off)",
    };
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const expected = expectedDeltas();
  const full = result.full ?? {};
  const abort = result.abort ?? {};
  const checks = {
    fullChunksGe2: full.chunks >= 2,
    fullEventsComplete:
      Array.isArray(full.deltas) &&
      JSON.stringify(full.deltas) === JSON.stringify(expected) &&
      full.sawDone === true,
    abortClean: abort.aborted === true && abort.lateChunks === 0,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) {
    return { verdict: "RED", reason: `device checks failed: ${failed.join(",")}`, detail: result };
  }
  return {
    verdict: "PASS",
    reason: "device carried full SSE corpus chunked and aborted cleanly",
    counts: { fullChunks: full.chunks, abortLateChunks: abort.lateChunks },
    detail: result,
  };
}
