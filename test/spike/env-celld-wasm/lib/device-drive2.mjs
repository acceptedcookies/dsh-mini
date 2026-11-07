// 真机驱动 v2 —— 严格镜像 scripts/dev-cli/device.mjs 实测序列（DSH_PROJECT 指到 spike mp）：
//  ProbeDriver.open(via:mcp,needAutomator) → evaluate brand → 桥在听? → 不在则 MCP
//  remote:auto 开窗+推送 → remote() 仅一次 → 只等 onRemoteDebugConnected →
//  evaluate 轮询 probeResult。禁止：重发 remote、兜底 remote、disableRemoteDebug。
import { connect } from "node:net";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { ProbeDriver } from "../../../../scripts/dev-cli/lib/probe.mjs";

async function bridgeAlive() {
  try {
    const root = join(homedir(), "Library/Application Support/微信开发者工具");
    let latest = null, m0 = 0;
    for (const e of readdirSync(root)) {
      const ld = join(root, e, "WeappLog/logs");
      if (!existsSync(ld)) continue;
      for (const f of readdirSync(ld)) {
        const fp = join(ld, f);
        const m = statSync(fp).mtimeMs;
        if (m > m0) { m0 = m; latest = fp; }
      }
    }
    if (!latest) return false;
    const hits = [...readFileSync(latest, "utf8").matchAll(/ws=127\.0\.0\.1:(\d+)/g)];
    if (!hits.length) return false;
    const port = Number(hits[hits.length - 1][1]);
    return await new Promise((res) => {
      const s = connect({ host: "127.0.0.1", port }, () => { s.end(); res(true); });
      s.on("error", () => res(false));
      setTimeout(() => { s.destroy(); res(false); }, 3000);
    });
  } catch { return false; }
}

export async function driveDevice(spikeDir, { connectTimeoutMs = 90_000, resultTimeoutMs = 45_000 } = {}) {
  const mpDir = resolve(join(spikeDir, "mp"));
  process.env.DSH_PROJECT = mpDir; // ProbeDriver/args.mjs 的项目投影
  const d = await ProbeDriver.open({ via: "mcp", needAutomator: true, automatorOpts: {} });
  const mp = d.mp;
  const evalJ = (src) => mp.evaluate(new Function(`return (${src})()`));
  const info = async () => (await evalJ(`() => ({ device: wx.getDeviceInfo(), base: wx.getAppBaseInfo() })`).catch(() => null));
  const onDev = (v) => {
    const b = v?.device?.brand, p = v?.device?.platform;
    return (b && b !== "devtools") || (p && p !== "devtools");
  };

  let device = await info();
  if (!onDev(device)) {
    // 未连 → 桥在听? 不在先开窗（MCP remote:auto = 开窗 + 自动推送绑定设备）
    if (!(await bridgeAlive())) {
      await d.remoteDevice().catch(() => {});
      // 等窗口桥起来
      const dl = Date.now() + 20_000;
      while (Date.now() < dl && !(await bridgeAlive())) await new Promise((r) => setTimeout(r, 1000));
      if (!(await bridgeAlive())) {
        await d.close().catch(() => {});
        return { ok: false, reason: "remote-debug window bridge never came alive" };
      }
    }
    // 桥在听 → remote() 仅一次，只等事件，不重发
    const wait = new Promise((res) => {
      mp.connection.once("Tool.onRemoteDebugConnected", () => res(true));
      setTimeout(() => res(false), connectTimeoutMs);
    });
    mp.remote(true).catch(() => {});
    const ok = await wait;
    if (!ok) {
      await d.close().catch(() => {});
      return { ok: false, reason: `no onRemoteDebugConnected within ${connectTimeoutMs}ms` };
    }
    const dl = Date.now() + 40_000;
    while (Date.now() < dl && !onDev(device)) {
      device = await info();
      if (!onDev(device)) await new Promise((r) => setTimeout(r, 1200));
    }
    if (!onDev(device)) {
      await d.close().catch(() => {});
      return { ok: false, reason: "connected but brand still devtools (session not routed to device)" };
    }
  }

  const dev = device?.device ?? {}, base = device?.base ?? {};
  const deviceInfo = {
    model: dev.model ?? null, brand: dev.brand ?? null, platform: dev.platform ?? null,
    system: dev.system ?? null, wechatVersion: base.version ?? null, baseLibVersion: base.SDKVersion ?? null,
  };
  const deadline = Date.now() + resultTimeoutMs;
  let result = null;
  while (Date.now() < deadline) {
    result = await evalJ(`() => { const a = getApp(); return a && a.globalData ? a.globalData.probeResult : null }`).catch(() => null);
    if (result) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  await d.close().catch(() => {});
  if (!result) return { ok: false, reason: "probeResult absent", device: deviceInfo };
  return { ok: true, device: deviceInfo, result };
}
