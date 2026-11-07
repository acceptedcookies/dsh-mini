// miniprogram-automator driver for the sim/device lanes.
import automator from "miniprogram-automator";

const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";

export async function launchSpikeMp(projectPath, { timeoutMs = 60_000 } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const miniProgram = await Promise.race([
    automator.launch({ cliPath: CLI_PATH, projectPath, port }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`automator launch timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
  return miniProgram;
}

export async function grabProbeResult(miniProgram, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await miniProgram.evaluate(() => {
      const app = getApp();
      return app && app.globalData ? app.globalData.probeResult : null;
    });
    if (result) return result;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function deviceInfo(miniProgram) {
  try {
    const device = await miniProgram.evaluate(() => wx.getDeviceInfo());
    const base = await miniProgram.evaluate(() => wx.getAppBaseInfo());
    return {
      model: device.model ?? "devtools-simulator",
      osVersion: device.system ?? null,
      wechatVersion: base.version ?? null,
      baseLibVersion: base.SDKVersion ?? null,
      sdkVersion: null,
    };
  } catch {
    return null;
  }
}

export async function closeMp(miniProgram) {
  try {
    await miniProgram.close();
  } catch {}
}
