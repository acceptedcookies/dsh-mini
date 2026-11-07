// CDP 附着驱动 v2：零 remote 推送。Target.getTargets → attachToTarget(appservice)
// → 在设备 appservice 会话内 Runtime.evaluate 读 probeResult → golden 对照 → receipt。
import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { connect } from "node:net";

const SPIKE = "/Users/seanz/Documents/dsh-mini/test/spike/env-celld-wasm";

function currentInspectPort() {
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
  if (!latest) return null;
  const hits = [...readFileSync(latest, "utf8").matchAll(/inspectUrl: 'devtools:\/\/[^']*ws=127\.0\.0\.1:(\d+)/g)];
  return hits.length ? Number(hits[hits.length - 1][1]) : null;
}

const tcpAlive = (port) =>
  new Promise((res) => {
    const s = connect({ host: "127.0.0.1", port }, () => { s.end(); res(true); });
    s.on("error", () => res(false));
    setTimeout(() => { s.destroy(); res(false); }, 3000);
  });

function cdp(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let id = 0;
    const pend = new Map();
    const send = (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pend.set(mid, { res, rej });
        const msg = { id: mid, method, params };
        if (sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
        setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error(`cdp timeout ${method}`)); } }, 15000);
      });
    ws.onopen = () => resolve({ send, close: () => { try { ws.close(); } catch {} } });
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) {
          const { res, rej } = pend.get(m.id);
          pend.delete(m.id);
          m.error ? rej(new Error(m.error.message)) : res(m.result);
        }
      } catch {}
    };
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(() => reject(new Error("ws connect timeout")), 8000);
  });
}

const evalIn = async (c, expression, sessionId) => {
  const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`eval exception: ${(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "").slice(0, 300)}`);
  return r.result?.value;
};

const STATE_EXPR = `JSON.stringify((() => { try { const d = wx.getDeviceInfo(); const b = wx.getAppBaseInfo(); const a = getApp(); const p = getCurrentPages(); return { device: { brand: d.brand, model: d.model, platform: d.platform, system: d.system }, base: { version: b.version, sdk: b.SDKVersion }, probe: a && a.globalData ? a.globalData.probeResult : null, page: p.length ? p[p.length-1].route : null, wxWasm: typeof WXWebAssembly }; } catch (e) { return { err: String(e && e.message || e) }; } })())`;

const main = async () => {
  const port = currentInspectPort();
  if (!port) return console.log(JSON.stringify({ verdict: "NOT_RUN", reason: "no inspectUrl in WeappLog" }));
  if (!(await tcpAlive(port))) return console.log(JSON.stringify({ verdict: "NOT_RUN", reason: `inspect ws ${port} dead (debug window closed)` }));
  const c = await cdp(port);

  // 目标发现：appservice 才是设备小程序运行时
  let targets = [];
  try {
    const r = await c.send("Target.getTargets");
    targets = r.targetInfos ?? [];
  } catch (e) {
    console.log(JSON.stringify({ verdict: "NOT_RUN", reason: `Target.getTargets failed: ${e.message}`, transport: "cdp-attach" }));
    c.close();
    return;
  }
  const pick =
    targets.find((t) => /appservice/i.test(t.url ?? "")) ??
    targets.find((t) => /appservice/i.test(t.title ?? "")) ??
    targets.find((t) => t.type === "page" && !/^devtools:\/\//.test(t.url ?? ""));
  const targetList = targets.map((t) => ({ type: t.type, url: (t.url ?? "").slice(0, 80), title: (t.title ?? "").slice(0, 40) }));
  if (!pick) {
    console.log(JSON.stringify({ verdict: "NOT_RUN", reason: "no appservice target found", targets: targetList, transport: "cdp-attach" }));
    c.close();
    return;
  }
  const { sessionId } = await c.send("Target.attachToTarget", { targetId: pick.targetId, flatten: true });
  await c.send("Runtime.enable", {}, sessionId).catch(() => {});

  let state = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { state = JSON.parse(await evalIn(c, STATE_EXPR, sessionId)); } catch (e) { state = { err: e.message }; }
    if (state?.probe) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  c.close();

  const golden = readFileSync(join(SPIKE, "fixtures", "golden-transcript.txt"), "utf8");
  const platform = `${state?.device?.brand ?? ""} ${state?.device?.model ?? ""} ${state?.device?.platform ?? ""} ${state?.device?.system ?? ""}`.toLowerCase();
  const lane = /ios|iphone|ipad|apple/.test(platform) ? "ec-r1" : /android/.test(platform) ? "ec-r2" : null;
  const isSim = (state?.device?.brand ?? "devtools") === "devtools";
  let verdict = "NOT_RUN", reason = "", counts = {};
  if (state?.err) { reason = `appservice eval error: ${state.err}`; }
  else if (isSim) { reason = "attached target is devtools simulator, not physical device"; }
  else if (!state?.probe) { reason = "probeResult absent (spike mp not running on device)"; }
  else {
    const t = state.probe.celld?.transcript ?? "";
    const exact = t === golden;
    let steps = null;
    try { steps = JSON.parse(t).tail?.steps ?? null; } catch {}
    counts = { transcriptBytes: t.length, steps, memoryBytes: state.probe.celld?.memoryBytes ?? null, instantiateMs: state.probe.celld?.instantiateMs ?? null };
    verdict = exact && state.probe.celld?.instantiateOk && state.probe.bad?.threw ? "PASS" : "RED";
    reason = exact ? `device transcript byte-exact vs golden (${t.length}B)` : `transcript mismatch (${t.length}B vs golden ${golden.length}B)`;
  }
  const receipt = {
    id: lane ? lane.toUpperCase() : "EC-R?", lane: "device", verdict, reason,
    envClass: lane === "ec-r1" ? "ios" : lane === "ec-r2" ? "android" : "unknown",
    grade: lane === "ec-r1" ? "R1" : lane === "ec-r2" ? "R2" : null,
    at: new Date().toISOString(),
    device: state?.device ? { ...state.device, wechatVersion: state.base?.version ?? null, baseLibVersion: state.base?.sdk ?? null } : null,
    counts, transport: "cdp-attach (zero remote push)", page: state?.page ?? null,
    apiSurface: state?.probe?.apiSurface ?? null, targets: targetList,
  };
  if (lane && verdict === "PASS") {
    const dir = join(SPIKE, "evidence", lane);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 1));
};

main().catch((e) => console.log(JSON.stringify({ verdict: "ERROR", reason: String((e && e.message) || e) })));
