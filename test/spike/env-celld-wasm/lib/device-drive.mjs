// 真机驱动（dev-cli 契约版）：
//  1) automator.launch(spike mp) 挂自动化
//  2) evaluate getDeviceInfo — brand!=devtools 即已连真机，绝不再发 remote
//  3) 未连 → MCP automation_viewport_action {action:'remote',auto:true}
//     （自动真机调试：推送到已绑定设备，无扫码）→ 等 Tool.onRemoteDebugConnected
//  4) 兜底 mp.remote(true) 一轮（窗口已在听时直发即可）
//  5) evaluate 轮询 globalData.probeResult
import automator from "miniprogram-automator";
import { join, resolve } from "node:path";
import { McpClient } from "../../../../scripts/dev-cli/lib/mcp.mjs";

const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";

export async function driveDevice(spikeDir, { scanTimeoutMs = 90_000, resultTimeoutMs = 45_000 } = {}) {
  const mpDir = join(spikeDir, "mp");
  const port = 9400 + Math.floor(Math.random() * 500);
  const mp = await automator.launch({ cliPath: CLI_PATH, projectPath: mpDir, port });
  const evalJ = (src) => mp.evaluate(new Function(`return (${src})()`));

  let device = await evalJ(`() => ({ device: wx.getDeviceInfo(), base: wx.getAppBaseInfo() })`).catch(() => null);
  const onDevice = () => {
    const b = device?.device?.brand, p = device?.device?.platform;
    return (b && b !== "devtools") || (p && p !== "devtools" && p !== undefined);
  };

  if (!onDevice()) {
    // 自动真机调试：MCP remote auto —— 开调试窗 + 推送绑定设备，无需扫码。
    const waitConnect = (ms) =>
      new Promise((res) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; res(v); } };
        mp.connection.once("Tool.onRemoteDebugConnected", () => fin(true));
        setTimeout(() => fin(false), ms);
      });
    let mcp;
    try {
      mcp = await McpClient.open({ project: resolve(mpDir), quiet: true });
      const wait = waitConnect(scanTimeoutMs);
      await mcp.text("automation_viewport_action", { action: "remote", auto: true }, { timeoutMs: 60000 }).catch((e) => { throw e; });
      const ok = await wait;
      if (!ok) {
        // 兜底：窗已开后直发 remote（响应假超时不 await）
        const wait2 = waitConnect(45_000);
        mp.remote(true).catch(() => {});
        await wait2;
      }
    } catch (e) {
      try { mcp?.close?.(); } catch {}
      try { await mp.close(); } catch {}
      return { ok: false, reason: `auto remote failed: ${(e && e.message) || e}` };
    }
    try { mcp?.close?.(); } catch {}
    // 连接后等 App 冷启 + 探针：轮询 brand!=devtools
    const dl = Date.now() + 40_000;
    while (Date.now() < dl && !onDevice()) {
      device = await evalJ(`() => ({ device: wx.getDeviceInfo(), base: wx.getAppBaseInfo() })`).catch(() => null);
      if (!onDevice()) await new Promise((r) => setTimeout(r, 1200));
    }
    if (!onDevice()) {
      try { await mp.send("Tool.disableRemoteDebug").catch(() => {}); } catch {}
      try { await mp.close(); } catch {}
      return { ok: false, reason: "no physical device connected after remote-auto (device-absent)" };
    }
  }

  const dev = device?.device ?? {};
  const base = device?.base ?? {};
  const deviceInfo = {
    model: dev.model ?? null,
    brand: dev.brand ?? null,
    platform: dev.platform ?? null,
    system: dev.system ?? null,
    wechatVersion: base.version ?? null,
    baseLibVersion: base.SDKVersion ?? null,
  };

  const deadline = Date.now() + resultTimeoutMs;
  let result = null;
  while (Date.now() < deadline) {
    result = await evalJ(`() => { const a = getApp(); return a && a.globalData ? a.globalData.probeResult : null }`).catch(() => null);
    if (result) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  try { await mp.close(); } catch {}
  if (!result) return { ok: false, reason: "probeResult absent after device connect", device: deviceInfo };
  return { ok: true, device: deviceInfo, result };
}
