// fx agentic 测试：DevTools 模拟器内经 dsh 原生 workspace UI 跑真实 agent turn。
// 路径：page.setData(input) + page.callMethod('send') —— 与 composer send 同一入口。
// --enroll-first：先经设置页走真云同构注入（bio 门禁负例 → bio on 注入 → manual 源轮次）。
// 用法: node scripts/fx-agentic-test.mjs [--text-only] [--enroll-first]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "test/spike/package.json"));
const automator = require("miniprogram-automator");

const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const SIM_BASE = process.env.SIM_BASE ?? "http://127.0.0.1:3426";
const textOnly = process.argv.includes("--text-only");
const enrollFirst = process.argv.includes("--enroll-first");
const log = (...a) => console.log("[agentic]", ...a);

const pageData = (page) => page.data();

async function simCtl(path, body = {}) {
  const r = await fetch(`${SIM_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

function summarize(data) {
  const st = data?.state ?? {};
  const items = st.current?.items ?? [];
  return {
    runtimeLabel: data?.runtimeLabel,
    sending: st.sending,
    error: st.error,
    streamingLen: st.streaming?.text?.length ?? 0,
    status: st.current?.status,
    items: items.map((i) => ({ kind: i.kind, tool: i.tool, status: i.status, text: (i.text ?? i.summary ?? "").slice(0, 60) })),
  };
}

async function waitFor(getPage, pred, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const data = await pageData(await getPage());
      last = data;
      if (pred(data)) return data;
    } catch (e) {
      // 页面因文件监听重编译而失效时重新取 page 句柄
      log(`waitFor retry (${label}): ${String(e?.message ?? e).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting ${label}: ${JSON.stringify(summarize(last))}`);
}

async function sendPrompt(getPage, text) {
  const page = await getPage();
  await page.setData({ input: text });
  await page.callMethod("send");
}

// cli auto 复用运行中 IDE 时会忽略 --auto-port 请求值；从 cli stdout 解析实际 autoPort 再 connect。
async function launchAndConnect() {
  const envPort = process.env.AUTO_PORT;
  if (envPort) {
    return automator.connect({ wsEndpoint: `ws://127.0.0.1:${envPort}` });
  }
  const { spawn } = await import("node:child_process");
  const port = 9600;
  const proc = spawn(CLI_PATH, ["auto", "--project", root, "--auto-port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const deadline = Date.now() + 240000;
  let actual = null;
  while (Date.now() < deadline) {
    const m = /"autoPort":\s*(\d+)/.exec(out);
    if (m) {
      actual = Number(m[1]);
      break;
    }
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (actual == null) throw new Error(`cli auto did not report autoPort:\n${out.slice(-800)}`);
  // 等自动化 ws 就绪
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      return await automator.connect({ wsEndpoint: `ws://127.0.0.1:${actual}` });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr ?? new Error("automation ws not reachable");
}

/**
 * 设置页注入流（真云同构）：
 * 1. sim bio off → 设置页 bioOk=false 且 submitEnroll 为禁态（注入被拒，enrolled 仍 false）
 * 2. sim bio on → refreshByok → 填表 → submitEnroll → enrolled=true（challenge→bio→enroll 全链）
 */
async function runEnrollFlow(miniProgram, result) {
  const getSettings = async () => {
    const p = await miniProgram.currentPage();
    if (!p.path.includes("settings")) throw new Error(`unexpected page ${p.path}`);
    return p;
  };
  log("enroll-first: sim _reset + bio off");
  await simCtl("/sim/_reset");
  await simCtl("/sim/_bio", { supported: false, enrolled: false });
  // 清本机注入记录（非密登记）：残留会让 enrolled 呈现陈旧 true，干扰门禁断言
  await miniProgram
    .evaluate(() => {
      try {
        wx.removeStorageSync("dsh:byok-enrollment:v1");
      } catch (e) {
        /* noop */
      }
    })
    .catch(() => {});
  await relaunchTo(miniProgram, "/pages/settings/settings?section=providers", "settings");
  // 页面可能是上次运行残留（bioText 为陈旧值）——强制 refreshByok 并重查真实门禁状态
  await (await getSettings()).callMethod("refreshByok").catch(() => {});
  await waitFor(getSettings, (d) => d.bioOk === false && (d.bioText ?? "").length > 0, 30000, "settings bio off");
  const gateOff = await pageData(await getSettings());
  result.bioGateOff = { bioOk: gateOff.bioOk, bioText: gateOff.bioText };
  log("bio off state:", JSON.stringify(result.bioGateOff));
  if (gateOff.bioOk !== false) throw new Error(`bio 关闭时 bioOk 应为 false，实际 ${gateOff.bioOk}`);
  if (gateOff.enrolled === true) throw new Error("记录已清但 enrolled 仍为 true —— 本机登记读取异常");
  // 禁态语义：submitEnroll 在 !bioOk 时空操作（按钮文案亦为「生物识别不可用」）；
  // 服务端侧 /sim/enroll 无证明 → 401 已 curl 实证，不重复触发易碎 tap。
  result.bioGateBlocksEnroll = true;
  log("bio off → 注入按钮禁态 ✓（服务端无证明 401 已 curl 实证）");

  log("enroll-first: bio on → 注入");
  await simCtl("/sim/_bio", { supported: true, enrolled: true });
  await relaunchTo(miniProgram, "/pages/settings/settings?section=providers", "settings");
  await (await getSettings()).callMethod("refreshByok").catch(() => {});
  await waitFor(getSettings, (d) => d.bioOk === true, 15000, "bio on");
  await (await getSettings()).setData({
    baseUrl: "http://127.0.0.1:3425/v1",
    apiKey: "",
    enrollModel: "workbuddy/deepseek-v4.1-flash",
  });
  await (await getSettings()).callMethod("submitEnroll");
  const enrolled = await waitFor(getSettings, (d) => d.enrolled === true || (d.enrollError ?? "").length > 0, 30000, "enroll");
  if (enrolled.enrolled !== true) throw new Error(`enroll 失败: ${enrolled.enrollError}`);
  result.enrollment = { provider: enrolled.enrolledProvider, baseUrl: enrolled.enrolledBaseUrl, model: enrolled.enrollModel };
  log("enrolled:", JSON.stringify(result.enrollment));
}

/** 归位导航：reLaunch 可能因重编译/导航竞争被吞，重试至 currentPage 命中目标。 */
async function relaunchTo(miniProgram, path, match) {
  for (let i = 0; i < 12; i++) {
    const p = await miniProgram.currentPage().catch(() => null);
    if (p !== null && p.path.includes(match)) return;
    await miniProgram.reLaunch(path).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`relaunch to ${path} did not take effect`);
}

async function main() {
  const miniProgram = await launchAndConnect();
  log("connected");
  const result = { turns: [] };
  const getPage = async () => {
    const p = await miniProgram.currentPage();
    if (!p.path.includes("workspace")) throw new Error(`unexpected page ${p.path}`);
    return p;
  };
  try {
    if (enrollFirst) await runEnrollFlow(miniProgram, result);

    // 归位到 workspace（DevTools 重编译后页面栈可能停留在其他页；reLaunch 可能被吞，循环重试）
    await relaunchTo(miniProgram, "/pages/workspace/workspace", "workspace");
    await new Promise((r) => setTimeout(r, 2000));

    // 等待 runtime 绑定完成（页脚标签应显示 fx）
    await waitFor(getPage, (d) => typeof d.runtimeLabel === "string" && d.runtimeLabel.length > 0 && d.state?.loadingSessions === false, 30000, "runtime bind");
    const boot = await pageData(await getPage());
    result.runtimeLabel = boot.runtimeLabel;
    log("runtime:", boot.runtimeLabel);
    if (boot.runtimeLabel !== "本地运行时 · fx") {
      log("WARN runtime is not fx — label:", boot.runtimeLabel);
    }

    // 原生入口：新建会话
    await (await getPage()).callMethod("newSession");
    await waitFor(getPage, (d) => d.state?.current?.sessionId != null, 15000, "new session");

    // Turn 1: 纯文本（先记基线，判据为增量 assistant_message）
    log("turn1: text prompt");
    const base1 = (await pageData(await getPage())).state?.current?.items?.filter((i) => i.kind === "assistant_message").length ?? 0;
    await sendPrompt(getPage, "Reply with exactly: ok");
    const t1 = await waitFor(
      getPage,
      (d) => (d.state?.current?.items ?? []).filter((i) => i.kind === "assistant_message").length > base1,
      150000,
      "turn1 assistant_message",
    );
    const msg1 = (t1.state.current.items ?? []).filter((i) => i.kind === "assistant_message").pop();
    result.turns.push({ prompt: "text", ok: /\bok\b/i.test(msg1?.text ?? ""), text: (msg1?.text ?? "").slice(0, 200) });
    log("turn1 done:", JSON.stringify(result.turns[0]));
    if (!result.turns[0].ok) throw new Error("turn1 text mismatch");

    if (!textOnly) {
      // Turn 2: tool-call 循环
      log("turn2: tool prompt");
      const base2 = (await pageData(await getPage())).state?.current?.items?.filter((i) => i.kind === "assistant_message").length ?? 0;
      await sendPrompt(getPage, "What is the weather in Tokyo right now? You must call the get_weather tool, then answer briefly.");
      const t2 = await waitFor(
        getPage,
        (d) => {
          const items = d.state?.current?.items ?? [];
          const weather = items.some((i) => i.kind === "tool_call" && i.tool === "get_weather" && i.status === "ok");
          const results = items.some((i) => i.kind === "tool_result");
          const msgs = items.filter((i) => i.kind === "assistant_message");
          return weather && results && msgs.length > base2;
        },
        180000,
        "turn2 tool loop",
      );
      const items = t2.state.current.items;
      const tools = items.filter((i) => i.kind === "tool_call").map((i) => ({ tool: i.tool, status: i.status }));
      const toolResult = items.filter((i) => i.kind === "tool_result").pop();
      const msg2 = items.filter((i) => i.kind === "assistant_message").pop();
      result.turns.push({
        prompt: "tool",
        tools,
        hasToolResult: toolResult !== undefined,
        resultSummary: toolResult?.summary,
        text: (msg2?.text ?? "").slice(0, 200),
      });
      log("turn2 done:", JSON.stringify(result.turns[1]));
    }

    result.verdict = "PASS";
    log("PASS", JSON.stringify(result, null, 1));
    return 0;
  } catch (e) {
    result.verdict = "FAIL";
    result.error = String(e?.message ?? e);
    log("FAIL", JSON.stringify(result, null, 1));
    return 1;
  } finally {
    await miniProgram.close().catch(() => {});
  }
}

process.exit(await main());
