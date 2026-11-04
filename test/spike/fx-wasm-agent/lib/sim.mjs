// 模拟器驱动共享层：launch → 触发页面动作 → 轮询 globalData.fxTest。
import { join } from "node:path";
import { launchSpikeMp, closeMp, deviceInfo } from "./automator.mjs";

export async function driveSim(spikeDir, action, { prompt, timeoutMs = 120_000 } = {}) {
  const projectPath = join(spikeDir, "mp");
  const miniProgram = await launchSpikeMp(projectPath);
  const device = await deviceInfo(miniProgram);
  try {
    if (prompt !== undefined) {
      await miniProgram.evaluate((p) => {
        const pages = getCurrentPages();
        pages[pages.length - 1].setData({ prompt: p });
      }, prompt);
    }
    await miniProgram.evaluate((a) => {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      if (a === "send") page.onSend();
      else if (a === "probe") page.onProbe();
    }, action);
    const deadline = Date.now() + timeoutMs;
    let fxTest = null;
    const donePhases = ["done", "error", "probe-done", "probe-error"];
    while (Date.now() < deadline) {
      fxTest = await miniProgram.evaluate(() => getApp()?.globalData?.fxTest ?? null);
      if (fxTest && donePhases.includes(fxTest.phase)) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    return { fxTest, device };
  } finally {
    await closeMp(miniProgram);
  }
}
