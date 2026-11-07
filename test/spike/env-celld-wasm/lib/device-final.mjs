// 终版真机驱动：严格 device.mjs 序列，作用于 spike 工程自动化会话。
// 1) connect 9420 → brand 判定 2) 未连→mp.remote() 仅一次→等 onRemoteDebugConnected
// 3) 轮询 brand≠devtools 4) 轮询 probeResult 5) golden 对照 6) receipt
import automator from "miniprogram-automator";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPIKE = "/Users/seanz/Documents/dsh-mini/test/spike/env-celld-wasm";

const main = async () => {
  const mp = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
  const ev = (src) => mp.evaluate(new Function(`return (${src})()`));
  const info = () => ev(`() => ({ d: wx.getDeviceInfo(), b: wx.getAppBaseInfo() })`).catch(() => null);
  const isDev = (v) => (v?.d?.brand ?? "devtools") === "devtools" && (v?.d?.platform ?? "devtools") === "devtools";

  let st = await info();
  if (isDev(st)) {
    const wait = new Promise((res) => {
      mp.connection.once("Tool.onRemoteDebugConnected", () => res(true));
      setTimeout(() => res(false), 90_000);
    });
    mp.remote(true).catch(() => {});
    const ok = await wait;
    if (!ok) return console.log(JSON.stringify({ verdict: "NOT_RUN", reason: "no onRemoteDebugConnected in 90s" }));
    const dl = Date.now() + 45_000;
    while (Date.now() < dl && isDev(st)) {
      st = await info();
      if (isDev(st)) await new Promise((r) => setTimeout(r, 1200));
    }
    if (isDev(st)) return console.log(JSON.stringify({ verdict: "NOT_RUN", reason: "brand still devtools after connect" }));
  }

  const device = { brand: st?.d?.brand, model: st?.d?.model, platform: st?.d?.platform, system: st?.d?.system, wechatVersion: st?.b?.version, baseLibVersion: st?.b?.SDKVersion };
  const plat = `${device.brand} ${device.model} ${device.platform} ${device.system}`.toLowerCase();
  const lane = /ios|iphone|ipad|apple/.test(plat) ? "ec-r1" : /android/.test(plat) ? "ec-r2" : null;

  let probe = null;
  const dl = Date.now() + 45_000;
  while (Date.now() < dl) {
    probe = await ev(`() => { const a = getApp(); return a && a.globalData ? a.globalData.probeResult : null }`).catch(() => null);
    if (probe) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!probe) return console.log(JSON.stringify({ verdict: "NOT_RUN", reason: "probeResult absent on device", device }));

  const golden = readFileSync(join(SPIKE, "fixtures", "golden-transcript.txt"), "utf8");
  const t = probe.celld?.transcript ?? "";
  const exact = t === golden;
  let steps = null;
  try { steps = JSON.parse(t).tail?.steps ?? null; } catch {}
  const verdict = exact && probe.celld?.instantiateOk && probe.bad?.threw ? "PASS" : "RED";
  const receipt = {
    id: lane ? lane.toUpperCase() : "EC-R?", lane: "device", verdict,
    reason: exact ? `device transcript byte-exact vs golden (${t.length}B)` : `transcript mismatch (${t.length}B vs ${golden.length}B)`,
    envClass: lane === "ec-r1" ? "ios" : lane === "ec-r2" ? "android" : "unknown",
    grade: lane === "ec-r1" ? "R1" : lane === "ec-r2" ? "R2" : null,
    at: new Date().toISOString(), device, transport: "automator remote-debug (single remote push)",
    counts: { transcriptBytes: t.length, steps, memoryBytes: probe.celld?.memoryBytes ?? null, instantiateMs: probe.celld?.instantiateMs ?? null },
    apiSurface: probe.apiSurface, badThrew: probe.bad?.threw ?? null,
  };
  if (lane && verdict === "PASS") {
    const dir = join(SPIKE, "evidence", lane);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 1));
  process.exit(0);
};

main().catch((e) => console.log(JSON.stringify({ verdict: "ERROR", reason: String((e && e.message) || e) })));
