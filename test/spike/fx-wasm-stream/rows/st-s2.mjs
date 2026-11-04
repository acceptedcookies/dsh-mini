// ST-S2 — DevTools abort 干净 (V-T4)
import { join } from "node:path";
import { startMockSse } from "../lib/sse-server.mjs";
import {
  launchSpikeMp,
  setTargetUrl,
  grabProbeResult,
  clearProbeResult,
  deviceInfo,
  closeMp,
} from "../lib/automator.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const mpDir = join(spikeDir, "mp");
  const mock = await startMockSse({ delayMs: 60 });
  let miniProgram;
  try {
    try {
      miniProgram = await launchSpikeMp(mpDir);
    } catch (e) {
      return { verdict: "NOT_RUN", reason: `automator launch failed: ${(e && e.message) || e}` };
    }
    const device = await deviceInfo(miniProgram);
    // first chunk arrives → page aborts. Drive via the page's abort arm by
    // pointing the page at the url then invoking its abort method through the
    // probe contract: the page runs FULL probe on targetUrl; for the abort arm
    // we call the page method that runs with abortAfterFirst.
    const page = await miniProgram.currentPage();
    await miniProgram.evaluate((u) => {
      getApp().globalData.probeResult = null;
      const p = getCurrentPages()[0];
      p.setData({ url: u });
      p._run(true);
    }, mock.url);
    const result = await grabProbeResult(miniProgram, { timeoutMs: 40_000 });
    if (!result) {
      return { verdict: "RED", reason: "no probe result within 40s", device };
    }
    const checks = {
      aborted: result.aborted === true,
      firstChunkSeen: result.chunks >= 1,
      noLateChunks: result.lateChunks === 0,
      noError: !result.error || /abort/i.test(result.error) === false,
    };
    // abort itself may surface a fail/complete with errMsg 'request:fail abort' —
    // that is a clean abort, not an error for our purposes; only parse/other errors count.
    const parseError = result.error && !/abort/i.test(result.error);
    checks.noError = !parseError;
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `abort arm failed: ${failed.join(",")}`,
        counts: { chunks: result.chunks, lateChunks: result.lateChunks },
        device,
        detail: result,
      };
    }
    return {
      verdict: "PASS",
      reason: "abort() stopped delivery: no chunks observed after abort across the 800ms settle window",
      counts: { chunks: result.chunks, lateChunks: result.lateChunks, events: result.events?.length ?? 0 },
      device,
      detail: { chunkBytes: result.chunkBytes, error: result.error },
    };
  } finally {
    await closeMp(miniProgram);
    await mock.close();
  }
}
