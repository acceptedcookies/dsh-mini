// miniprogram-automator driver for the sim lane.
// Post-review hardening: every evaluate() call is wrapped in a per-call timeout
// so a wedged JS thread (e.g. 4MB Module compile) cannot hang the row forever,
// and target injection retries transient evaluate failures.
import automator from "miniprogram-automator";

const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timeout after ${ms}ms`)), ms)),
  ]);
}

export async function launchSpikeMp(projectPath, { timeoutMs = 60_000 } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const miniProgram = await withTimeout(
    automator.launch({ cliPath: CLI_PATH, projectPath, port }),
    timeoutMs,
    "automator launch",
  );
  return miniProgram;
}

// Inject probe config: base url + arm selection. Retries transient evaluate
// failures; the page polls globalData.probeConfig and starts when it appears.
export async function setTargetConfig(miniProgram, { base, arms }, { retries = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      await withTimeout(
        miniProgram.evaluate(
          (b, a) => {
            getApp().globalData.probeConfig = { base: b, arms: a };
          },
          base,
          arms,
        ),
        15_000,
        "setTargetConfig evaluate",
      );
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

// Legacy single-field injection kept for callers that only set a base url.
export async function setTargetBase(miniProgram, url) {
  return setTargetConfig(miniProgram, { base: url, arms: null });
}

export async function grabProbeResult(miniProgram, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let result = null;
    try {
      result = await withTimeout(
        miniProgram.evaluate(() => {
          const app = getApp();
          return app && app.globalData ? app.globalData.probeResult : null;
        }),
        15_000,
        "grabProbeResult evaluate",
      );
    } catch {
      // evaluate wedged once — page may still be compiling; keep polling
      // until the outer deadline so a slow arm doesn't fake a hang.
    }
    // Consider the probe done when every selected arm has a terminal entry.
    if (result && typeof result === "object") {
      const arms = result.arms || ["pathBaseline", "bytesRaw", "encPipeline", "fxReal"];
      const done = arms.every((a) => result[a] && (result[a].armWallMs !== undefined || result[a].skipped));
      if (done || result.fatal) return result;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function deviceInfo(miniProgram) {
  try {
    const device = await withTimeout(miniProgram.evaluate(() => wx.getDeviceInfo()), 15_000, "deviceInfo evaluate");
    const base = await withTimeout(miniProgram.evaluate(() => wx.getAppBaseInfo()), 15_000, "appBaseInfo evaluate");
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
