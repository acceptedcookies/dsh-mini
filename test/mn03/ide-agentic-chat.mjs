// MN03-B9 真 agentic 探针：DevTools 模拟器内经 __sessionStore 钩驱动完整
// agentic 轮——sessionStore.prompt() → runtime(kernel/fx) → io.llm/ACP →
// 真 magpie(127.0.0.1:3425) → 转录/UI。补 G3 缺口：llm-edge 只验传输缝，
// 本文件验真轮次（真实 LLM 应答进转录）+ 边缘（running 互斥/取消/上游 4xx→UI）。
//
// 旋钮：app.json dsh.* 是编译期内联真源——改写后必须等 watcher 整编+
// 重载收敛（构建会砸断 automator ws → 全程断线重连容错），不得信首次连接
// 的既有构建（实证：复用旧 bundle 跑出 route=cloud 幻影，MN03-B9 首轮踩坑）。
// app.json 测试结束恢复原值（旋钮真源归业主）。
//
// 用法: node test/mn03/ide-agentic-chat.mjs   [AUTO_PORT=xxxx 复用已开 IDE]
// IDE 不可达 → SKIP exit 3（documented-degradation，不算失败）。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const require = createRequire(join(root, "test/spike/package.json"));
const automator = require("miniprogram-automator");
const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const log = (...a) => console.log("[ide-agentic]", ...a);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── app.json 旋钮（save/restore）+ app.ts poke（扳 watcher 整编）─────────
// 实证（B9 首轮）：app.json 改写不触发热重载、require('../../app.json') 是编译
// 期内联——必须改一个 watcher 跟踪的源文件才会整编+重载+重读旋钮。
const APPJSON = join(root, "app.json");
const APPTS = join(root, "app.ts");
const origAppJson = readFileSync(APPJSON, "utf8");
const origAppTs = readFileSync(APPTS, "utf8");
let pokeN = 0;
const setKnobs = (knobs) => {
  const j = JSON.parse(readFileSync(APPJSON, "utf8"));
  j.dsh = { ...(j.dsh ?? {}), ...knobs };
  writeFileSync(APPJSON, JSON.stringify(j, null, 2) + "\n");
  // 实证（B9）：运行时 require app.json 读不到自定义顶层键——旋钮真源必须经
  // 生成器镜像进 dev-config.ts 才可达；dev-config 是源文件，重写即扳 watcher 整编。
  spawnSync("node", [join(root, "scripts/fx-dev-config.mjs")], { stdio: "pipe" });
};
// 追加唯一标记行：内容必变 → watcher 必整编（marker 由 cleanPokes 剥除）。
const pokeRebuild = () => {
  const cur = readFileSync(APPTS, "utf8");
  writeFileSync(APPTS, `${cur.replace(/\n*\/\/__B9_POKE_\d+__\n?/g, "")}\n//__B9_POKE_${++pokeN}__\n`);
};
const cleanPokes = () => writeFileSync(APPTS, origAppTs);
const restoreAppJson = () => {
  writeFileSync(APPJSON, origAppJson);
  // dev-config 重新镜像（旋钮真源恢复后通道同步——不留 local/fxLegacy 残影）。
  spawnSync("node", [join(root, "scripts/fx-dev-config.mjs")], { stdio: "pipe" });
};

// ── automator 连接（断线可重连——整编期间 ws 会死）────────────────────
let mini = null;
let wsEndpoint = process.env.AUTO_PORT ? `ws://127.0.0.1:${process.env.AUTO_PORT}` : null;
const connect = () => automator.connect({ wsEndpoint });
const safeEval = async (fn, arg) => {
  try { return await mini.evaluate(fn, arg); } catch { return undefined; }
};
async function launchAndConnect() {
  if (wsEndpoint !== null) return connect();
  const { spawn } = await import("node:child_process");
  const proc = spawn(CLI_PATH, ["auto", "--project", root, "--auto-port", "9602"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const deadline = Date.now() + 240000;
  let actual = null;
  while (Date.now() < deadline) {
    const m = /"autoPort":\s*(\d+)/.exec(out);
    if (m) { actual = Number(m[1]); break; }
    if (proc.exitCode !== null) break;
    await sleep(1000);
  }
  if (actual == null) throw new Error(`cli auto did not report autoPort:\n${out.slice(-800)}`);
  wsEndpoint = `ws://127.0.0.1:${actual}`;
  let lastErr = null;
  while (Date.now() < deadline) {
    try { return await connect(); } catch (e) { lastErr = e; await sleep(1500); }
  }
  throw lastErr;
}

// ── 快照/等待 ──────────────────────────────────────────────────────────
const snap = () => mini.evaluate(() => {
  const g = getApp().globalData;
  const s = g.__sessionStore.getState();
  return {
    lane: g.__sessionStore.runtimeLane(),
    route: g.__diagnostics().runtime.route,
    sending: s.sending,
    loading: s.loadingSessions || s.loadingSession,
    sessions: s.sessions.map((x) => x.id),
    current: s.current === undefined ? null : {
      sessionId: s.current.sessionId,
      status: s.current.status,
      items: s.current.items.map((i) => ({ kind: i.kind, status: i.status, text: (i.text ?? i.summary ?? "").slice(0, 400), tool: i.tool })),
    },
    error: s.error ?? null,
    streaming: s.streaming?.text?.length ?? 0,
  };
});

const anchor = async (ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const page = await mini.currentPage();
      if ((await page.path) === "pages/workspace/workspace") return page;
    } catch { /* 编译窗 */ }
    await sleep(900);
  }
  return null;
};

const waitFor = async (pred, timeoutMs, step = 800) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const s = await snap().catch(() => null);
    if (s !== null) { last = s; if (pred(s)) return { hit: true, last }; }
    await sleep(step);
  }
  return { hit: false, last };
};

// 真轮等待：先见 running/error（防陈旧 idle 抢跑），再等非 running 收尾。
const waitTurn = async (sid, timeoutMs) => {
  const armed = await waitFor(
    (s) => s.current?.sessionId === sid && (s.current.status === "running" || s.current.status === "error"),
    Math.min(timeoutMs, 30000));
  if (armed.last?.current?.status === "error") return { hit: true, last: armed.last };
  return waitFor((s) => s.current?.sessionId === sid && s.current.status !== "running", timeoutMs);
};

// 等构建收敛到目标 lane/route：周期 poke app.ts 扳整编，断线重连容错。
const waitBuild = async (pred, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let poked = 0;
  while (Date.now() < deadline) {
    try {
      const s = await snap();
      if (s !== null && pred(s)) return { hit: true, last: s };
    } catch { /* 构建窗 */ }
    if (Date.now() - poked > 15000) { try { pokeRebuild(); } catch { /* fs */ } poked = Date.now(); }
    await sleep(2000);
    try { mini = await connect(); } catch { /* ws 未就绪 */ }
  }
  return { hit: false, last: await snap().catch(() => null) };
};

// ═══════════════════════════════════════════════════════════════════════
try {
  setKnobs({ localRuntimeRoute: "local", fxLegacy: false });
  mini = await launchAndConnect();
} catch (e) {
  restoreAppJson();
  console.log(`SKIP: IDE/DevTools 不可达 — ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  process.exit(3);
}
log("connected", wsEndpoint);

try {
  // 启动构建可能复用旧 bundle（route=cloud 幻影）——poke 源文件逼整编。
  pokeRebuild();
  const boot = await waitBuild((s) => s.route === "local" && (s.lane === "kernel" || s.lane === "fx"), 180000);
  check("K1:local-runtime 车道就位（kernel, route=local）",
    boot.hit === true && boot.last?.lane === "kernel" && boot.last?.route === "local",
    `lane=${boot.last?.lane} route=${boot.last?.route}`);

  const page = await anchor(30000);
  log("page:", page === null ? "(unresolved)" : await page.path);

  // ── K2: 真 agentic 轮——prompt → kernel pump → io.llm → magpie ──────
  let sid;
  {
    sid = await safeEval(() => getApp().globalData.__sessionStore.create().then((id) => id ?? null));
    check("K2a:create() 会话就位", typeof sid === "string" && sid.length > 0, `sid=${sid}`);
    await safeEval((t) => { getApp().globalData.__sessionStore.prompt(t).then(() => true).catch(() => false); return true; },
      "Reply with the single word: pong");
    const { last } = await waitTurn(sid, 150000);
    const cur = last?.current ?? { items: [], status: "?" };
    const asst = cur.items.find((i) => i.kind === "assistant_message" && i.text.trim().length > 0);
    const user = cur.items.find((i) => i.kind === "user_message");
    check("K2b:真 magpie 轮完成（user+assistant 入转录）",
      cur.status !== "running" && cur.status !== "error" && user !== undefined && asst !== undefined,
      `status=${cur.status} items=${cur.items.map((i) => i.kind).join(",")} asst=${JSON.stringify(asst?.text ?? "").slice(0, 120)}`);
  }

  // ── K3: 第二轮（historyMessages 跨轮历史面）─────────────────────────
  {
    const before = (await snap().catch(() => null))?.current?.items.length ?? 0;
    await safeEval(() => { getApp().globalData.__sessionStore.prompt("And now reply with the single word: ping").then(() => true).catch(() => false); return true; });
    const { last } = await waitTurn(sid, 150000);
    const cur = last?.current ?? { items: [], status: "?" };
    const asstCount = cur.items.filter((i) => i.kind === "assistant_message" && i.text.trim().length > 0).length;
    check("K3:第二轮完成且转录增长", cur.status !== "running" && cur.items.length > before && asstCount >= 2,
      `status=${cur.status} items=${before}→${cur.items.length} asst=${asstCount}`);
  }

  // ── K4: durable 面——重开快照保留 + 诊断 bundle 字段 ─────────────────
  {
    await safeEval((id) => getApp().globalData.__sessionStore.open(id), sid);
    await sleep(700);
    const st = await snap().catch(() => null);
    const kept = st?.current?.items.filter((i) => i.kind === "assistant_message").length ?? 0;
    const diag = await safeEval((id) => {
      const b = getApp().globalData.__diagnostics(id);
      return { lane: b.runtime.lane, route: b.runtime.route, found: b.sessions.some((s) => s.id === id), errs: b.errors.recent.length };
    }, sid);
    check("K4:重开快照保留转录 + 诊断 lane/route 如实",
      kept >= 2 && diag?.lane === "kernel" && diag?.route === "local" && diag?.found === true,
      `kept=${kept} lane=${diag?.lane} route=${diag?.route} found=${diag?.found} errs=${diag?.errs}`);
  }

  // ── K5: running 互斥边缘——轮中第二 prompt 被挡且不产 user 行 ─────────
  {
    await safeEval(() => { getApp().globalData.__sessionStore.prompt("Write a long detailed essay about the history of computing, at least 500 words.").then(() => true).catch(() => false); return true; });
    const armed = await waitFor((s) => s.current?.sessionId === sid && s.current.status === "running", 20000, 300);
    const second = await safeEval(() => getApp().globalData.__sessionStore.prompt("duplicate while running").then((ok) => ok).catch(() => false));
    await sleep(400);
    const st = await snap().catch(() => null);
    const userRows = st?.current?.items.filter((i) => i.kind === "user_message" && i.text === "duplicate while running").length ?? 0;
    const busy = await safeEval(() => getApp().globalData.__errorBus.recent(30).filter((r) => r.code === "session-busy").length) ?? 0;
    check("K5:running 互斥——重发被挡(session-busy)且不产 user 行",
      armed.hit === true && userRows === 0 && (second === false || busy > 0),
      `armed=${armed.hit} second=${second} userRows=${userRows} busy=${busy} err=${st?.error ?? ""}`);
    await safeEval(() => getApp().globalData.__sessionStore.cancel());
    await waitFor((s) => s.current?.sessionId === sid && s.current.status !== "running", 90000);
  }

  // ── K6: cancel 边缘——步边界取消 → 注记 + idle，cancelled 不上横幅 ─────
  {
    await safeEval(() => { getApp().globalData.__sessionStore.prompt("Write another long essay, at least 500 words, about oceans.").then(() => true).catch(() => false); return true; });
    await waitFor((s) => s.current?.sessionId === sid && s.current.status === "running", 20000, 300);
    await safeEval(() => getApp().globalData.__sessionStore.cancel());
    // 步边界语义：在飞 llm 步完成后泵见 cancelled 收尾——给足一个 llm 步窗
    const { last } = await waitFor((s) => s.current?.sessionId === sid && s.current.status !== "running", 120000);
    const cur = last?.current ?? { items: [], status: "?" };
    const notice = cur.items.find((i) => i.kind === "notice" && i.text.includes("已请求停止"));
    // ?? -1：eval 断线失败给 -1 而非 0——「零 cancelled」leg 不真空通过（R5 nit）。
    const cancelledReports = await safeEval(() => getApp().globalData.__errorBus.recent(30).filter((r) => r.code === "cancelled").length) ?? -1;
    check("K6:cancel→停止注记 + idle，cancelled 不落错误面",
      cur.status === "idle" && notice !== undefined && cancelledReports === 0,
      `status=${cur.status} notice=${notice !== undefined} cancelledReports=${cancelledReports}`);
  }

  // ── K7: 真上游 404 边缘——白名单内坏模型 → io.llm upstream 404 → modal+页 ─
  {
    await safeEval(() => { getApp().globalData.__errorBus.clear(); });
    // deepseek-flash 在白名单（过 activeModel 闸）但不在 magpie 目录→真 404（curl 实测）。
    // 留底原模型——断言中断也恢复原值而非 removeStorage（丢用户原选，R5 minor）。
    const savedModel = await safeEval(() => wx.getStorageSync("dsh:model:v2") ?? null);
    await safeEval(() => { wx.setStorageSync("dsh:model:v2", "deepseek-flash"); return true; });
    await safeEval(() => { getApp().globalData.__sessionStore.prompt("Say hi").then(() => true).catch(() => false); return true; });
    const { last } = await waitTurn(sid, 120000);
    const bus = await safeEval(() => {
      const b = getApp().globalData.__errorBus.state();
      return { toasts: b.toasts.map((t) => t.code), modal: b.modal === null || b.modal === undefined ? null : { code: b.modal.code, lane: b.modal.diagnostics?.lane, sid: b.modal.diagnostics?.sessionId }, recent: getApp().globalData.__errorBus.recent(8).map((r) => r.code) };
    });
    let uiModal = null; let uiToasts = [];
    try { const pg = await mini.currentPage(); uiModal = await pg.data("errModal"); uiToasts = await pg.data("errToasts"); } catch { /* 页瞬断 */ }
    const modalHit = bus?.modal !== null && bus?.modal !== undefined && (bus.modal.code ?? "").startsWith("upstream-");
    const uiHit = (uiModal?.code ?? "").startsWith("upstream-") || (uiToasts ?? []).some((t) => (t.code ?? "").startsWith("upstream-"));
    check("K7:上游 4xx→status error + bus/页面错误面渲染（4xx=modal）",
      last?.current?.status === "error" && modalHit === true && uiHit === true,
      `status=${last?.current?.status} bus=${JSON.stringify(bus)} uiModal=${uiModal?.code ?? ""} uiToasts=${JSON.stringify((uiToasts ?? []).map((t) => t.code))}`);
    await safeEval((m) => {
      if (m === null || m === undefined || m === "") wx.removeStorageSync("dsh:model:v2");
      else wx.setStorageSync("dsh:model:v2", m);
      return true;
    }, savedModel);
    await safeEval(() => { const m = getApp().globalData.__errorBus.state().modal; if (m) getApp().globalData.__errorBus.dismiss(m.id, "modal"); return true; });
  }

  // ── K8: 台账聚合——诊断 errors.recent 含上游错误（同 bus 真源）────────
  {
    const codes = await safeEval(() => getApp().globalData.__diagnostics().errors.recent.map((r) => r.code)) ?? [];
    check("K8:诊断台账收录上游错误", codes.some((c) => c.startsWith("upstream-")), JSON.stringify(codes.slice(-8)));
  }

  // ══ PHASE B：fx wasm 车道（fxLegacy knob）══════════════════════════
  {
    setKnobs({ localRuntimeRoute: "local", fxLegacy: true });
    pokeRebuild();
    const fx = await waitBuild((s) => s.lane === "fx" && s.route === "local", 240000);
    check("F1:fxLegacy 翻 fx wasm 车道", fx.hit === true, `lane=${fx.last?.lane} route=${fx.last?.route}`);
    if (fx.hit === true) {
      await anchor(20000);
      // fx 首 prompt 触发 ensureCore——wasm 实例化+ACP init（秒~十秒级）
      const fsid = await safeEval(() => getApp().globalData.__sessionStore.create().then((id) => id ?? null));
      await safeEval(() => { getApp().globalData.__sessionStore.prompt("Reply with the single word: pong").then(() => true).catch(() => false); return true; });
      const { last } = await waitTurn(fsid, 240000);
      const cur = last?.current ?? { items: [], status: "?" };
      const asst = cur.items.find((i) => i.kind === "assistant_message" && i.text.trim().length > 0);
      check("F2:fx wasm ACP 真轮——magpie 应答入转录", cur.status !== "running" && cur.status !== "error" && asst !== undefined,
        `status=${cur.status} items=${cur.items.map((i) => i.kind).join(",")} asst=${JSON.stringify(asst?.text ?? "").slice(0, 120)}`);
      // F3: 工具轮——增量断言（不累计 F2 转录）+ status 不放行 error（R5 minor）。
      const before3 = cur.items.length;
      await safeEval(() => { getApp().globalData.__sessionStore.prompt("Use the get_weather tool for city Paris, then tell me the result.").then(() => true).catch(() => false); return true; });
      const end3 = await waitTurn(fsid, 240000);
      const delta3 = (end3.last?.current?.items ?? []).slice(before3);
      const toolItems = delta3.filter((i) => i.kind === "tool_call" || i.kind === "tool_result");
      const asst3 = delta3.filter((i) => i.kind === "assistant_message" && i.text.trim().length > 0).length;
      const s3 = end3.last?.current?.status;
      check("F3:fx 工具轮完成（tool_call 或文本应答——模型裁量如实记）",
        s3 !== "running" && s3 !== "error" && (toolItems.length > 0 || asst3 > 0),
        `status=${s3} tools=${toolItems.map((i) => `${i.kind}:${i.tool}:${i.status}`).join("|")} asst=${asst3}`);
    } else {
      check("F2:fx wasm ACP 真轮——magpie 应答入转录", false, "skipped: F1 未翻 fx 车道");
      check("F3:fx 工具轮完成（tool_call 或文本应答——模型裁量如实记）", false, "skipped: F1 未翻 fx 车道");
    }
  }
} finally {
  restoreAppJson();
  cleanPokes();
  try { await mini.disconnect(); } catch { /* 已断 */ }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`);
process.exit(failed.length === 0 ? 0 : 1);
