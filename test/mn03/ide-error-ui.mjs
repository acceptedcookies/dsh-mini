// MN03-B4 真 IDE 错误 UI 探针：DevTools 模拟器内经 __errorBus 合成错误，
// 断言 workspace 页 errToasts/errModal data 渲染 + __diagnostics evaluate 直达。
// 证据级：real Mini Program/DevTools（非 node shim）。evaluate 体禁 await——走 promise 链。
// 用法: node test/mn03/ide-error-ui.mjs   （IDE 已开时 AUTO_PORT=xxxx 复用）
// IDE 不可达 → SKIP exit 3（documented-degradation，不算失败）。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const require = createRequire(join(root, "test/spike/package.json"));
const automator = require("miniprogram-automator");
const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const log = (...a) => console.log("[ide-error-ui]", ...a);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); };

async function launchAndConnect() {
  const envPort = process.env.AUTO_PORT;
  if (envPort) return automator.connect({ wsEndpoint: `ws://127.0.0.1:${envPort}` });
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
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (actual == null) throw new Error(`cli auto did not report autoPort:\n${out.slice(-800)}`);
  let lastErr = null;
  while (Date.now() < deadline) {
    try { return await automator.connect({ wsEndpoint: `ws://127.0.0.1:${actual}` }); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw lastErr;
}

let mini;
try {
  mini = await launchAndConnect();
} catch (e) {
  console.log(`SKIP: IDE/DevTools 不可达 — ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  process.exit(3);
}
log("connected");

// 入口页可能停在分包引导页（kernel bootstrap——触发分包下载后自 navigateBack，
// 首下载窗可达数十秒）——先等自回退，超时再 wx.reLaunch 强锚 workspace。
// evaluate 不许等 reLaunch 完成——承诺随页面卸载销毁，同步返回后轮询锚定。
let page = await mini.currentPage();
const anchor = async (ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await page.path) === "pages/workspace/workspace") return true;
    await new Promise((r) => setTimeout(r, 700));
    page = await mini.currentPage();
  }
  return (await page.path) === "pages/workspace/workspace";
};
if (!(await anchor(30000))) {
  await mini.evaluate(() => { wx.reLaunch({ url: "/pages/workspace/workspace" }); return true; });
  await anchor(30000);
}
log("page:", await page.path);

// ── I1: globalData 钩子面 ──────────────────────────────────────────
{
  const hooks = await mini.evaluate(() => {
    const g = getApp().globalData;
    return { diag: typeof g.__diagnostics === "function", bus: typeof g.__errorBus === "object" && g.__errorBus !== null };
  });
  check("I1:__diagnostics/__errorBus 钩子就位", hooks.diag && hooks.bus, JSON.stringify(hooks));
}

// ── I2: __diagnostics evaluate 直达（G2 MCP 面）────────────────────
{
  const d = await mini.evaluate(() => {
    const b = getApp().globalData.__diagnostics();
    return { schema: b.schema, lane: b.runtime.lane, route: b.runtime.route, sessions: b.sessions.length, errs: b.errors.recent.length, version: b.env.version };
  });
  check("I2:bundle schema/字段齐", d.schema === "dsh-mini.diag.v1" && typeof d.lane === "string" && typeof d.route === "string" && typeof d.sessions === "number", JSON.stringify(d));
}

// ── I3: 合成 toast 错误 → 页面 errToasts 渲染 ──────────────────────
{
  // 真实后台错误（cloud 车道 401 等）会竞位——每段先 clear 保证确定性；
  // 残余真错误恰好自证 bus 接线（I2 errs>0 已录）。
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    getApp().globalData.__errorBus.report(new Error("request:fail timeout"), { op: "ide-probe", lane: "kernel" });
  });
  await new Promise((r) => setTimeout(r, 400));
  const page = await mini.currentPage();
  const toasts = await page.data("errToasts");
  const hit = Array.isArray(toasts) && toasts.find((t) => t.code === "network-timeout" && t.diagnostics.op === "ide-probe");
  check("I3:toast 合成→errToasts 渲染", hit !== undefined, JSON.stringify((toasts ?? []).map((t) => t.code)));
}

// ── I4: dedupe 同窗 → count=2 单 toast ─────────────────────────────
{
  // 专属 code 防真实 background 错误混入合并窗。
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    const bus = getApp().globalData.__errorBus;
    bus.report(new Error("io.llm upstream 429"), { op: "ide-probe", lane: "kernel" });
    bus.report(new Error("io.llm upstream 429"), { op: "ide-probe", lane: "kernel" });
  });
  await new Promise((r) => setTimeout(r, 400));
  const page = await mini.currentPage();
  const toasts = await page.data("errToasts");
  const matches = (toasts ?? []).filter((t) => t.code === "upstream-429");
  check("I4:dedupe 同窗 count 合并", matches.length === 1 && matches[0].count === 2, JSON.stringify(matches.map((t) => [t.code, t.count])));
}

// ── I5: 合成 modal 错误 → errModal 渲染 + dismiss ──────────────────
{
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    getApp().globalData.__errorBus.report(new Error("io.llm upstream 500: ide-probe"), { op: "ide-probe", lane: "kernel" });
  });
  await new Promise((r) => setTimeout(r, 400));
  const page = await mini.currentPage();
  const modal = await page.data("errModal");
  check("I5:modal 合成→errModal 渲染", modal !== null && modal !== undefined && modal.code === "upstream-500", JSON.stringify(modal && [modal.code, modal.title]));
  if (modal && modal.id) {
    await mini.evaluate((id) => { getApp().globalData.__errorBus.dismiss(id); }, modal.id);
    await new Promise((r) => setTimeout(r, 300));
    const after = await page.data("errModal");
    check("I5b:dismiss→errModal 清空", after === null || after === undefined);
  }
}

// ── I7: toast 手动关 tap（真实元素击面，R1 补 UI 形态断言）─────────────
{
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    getApp().globalData.__errorBus.report(new Error("io.llm upstream 429"), { op: "ide-close-probe" });
  });
  await new Promise((r) => setTimeout(r, 500));
  const page = await mini.currentPage();
  const closeEl = await page.$(".ec-toast-close");
  check("I7a:toast 关闭钮元素存在", closeEl !== null && closeEl !== undefined);
  if (closeEl) {
    await closeEl.tap();
    await new Promise((r) => setTimeout(r, 400));
    const toasts = await page.data("errToasts");
    check("I7b:手动关 tap→errToasts 清空", (toasts ?? []).length === 0, `remaining=${(toasts ?? []).length}`);
  }
}

// ── I8: toast 自动关计时（warn=5s 真实计时器）─────────────────────────
{
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    getApp().globalData.__errorBus.report(new Error("request:fail timeout"), { op: "ide-auto-probe" });
  });
  await new Promise((r) => setTimeout(r, 400));
  const page = await mini.currentPage();
  const before = await page.data("errToasts");
  await new Promise((r) => setTimeout(r, 5800));
  const after = await page.data("errToasts");
  check("I8:warn toast 5s 自动关", (before ?? []).length === 1 && (after ?? []).length === 0, `before=${(before ?? []).length} after=${(after ?? []).length}`);
}

// ── I9: 「详情」tap 升舱 modal + 复制全文真进剪贴板 ──────────────────────
{
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    getApp().globalData.__errorBus.report(new Error("io.llm upstream 503: ide-detail"), { op: "ide-probe", sessionId: "ide-s9" });
  });
  await new Promise((r) => setTimeout(r, 400));
  const page = await mini.currentPage();
  // upstream-503 本就是 modal——先关，再用 toast 形态测升舱
  await mini.evaluate(() => { getApp().globalData.__errorBus.clear(); });
  await mini.evaluate(() => {
    getApp().globalData.__errorBus.report(new Error("request:fail timeout"), { op: "ide-probe", sessionId: "ide-s9" });
  });
  await new Promise((r) => setTimeout(r, 400));
  const detailEl = await page.$(".ec-toast-detail");
  check("I9a:「详情」入口存在", detailEl !== null && detailEl !== undefined);
  if (detailEl) {
    await detailEl.tap();
    await new Promise((r) => setTimeout(r, 400));
    const modal = await page.data("errModal");
    const toasts = await page.data("errToasts");
    check("I9b:详情 tap→toast 升舱 modal", modal !== null && modal !== undefined && modal.code === "network-timeout" && (toasts ?? []).length === 0, JSON.stringify(modal && modal.code));
    // 复制全文 → wx.getClipboardData 回读验证（真剪贴板链）
    const copyBtn = await page.$(".ec-modal-foot dsh-button");
    if (copyBtn) {
      await copyBtn.tap();
      await new Promise((r) => setTimeout(r, 600));
      const clip = await mini.evaluate(() => new Promise((res) => {
        wx.getClipboardData({ success: (r2) => res(typeof r2.data === "string" ? r2.data.slice(0, 200) : ""), fail: () => res("") });
      }));
      check("I9c:复制全文→剪贴板含 code/session 行", typeof clip === "string" && clip.includes("code: network-timeout") && clip.includes("sessionId: ide-s9"), JSON.stringify((clip ?? "").slice(0, 80)));
      await mini.evaluate(() => { const m = getApp().globalData.__errorBus.state().modal; if (m) getApp().globalData.__errorBus.dismiss(m.id, "modal"); });
    } else {
      check("I9c:modal 复制钮存在", false, "copy button element not found");
    }
  }
}

// ── I6: 错误台账进 diagnostics bundle（同 bus 真源）─────────────────
{
  const d = await mini.evaluate(() => {
    const b = getApp().globalData.__diagnostics();
    return b.errors.recent.filter((r) => r.diagnostics && r.diagnostics.op === "ide-probe").map((r) => r.code);
  });
  check("I6:bundle.errors.recent 含合成错误", d.includes("network-timeout") && d.includes("upstream-500"), JSON.stringify(d));
}

await mini.disconnect();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS  @ ${new Date().toISOString()}`);
process.exit(failed.length === 0 ? 0 : 1);
