// AG-S* 驱动：DevTools 模拟器内真实 fx-core-async.wasm → magpie agent turn。
// 用法: node lib/drive-sim.mjs [--tool]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import automator from "miniprogram-automator";

const here = dirname(fileURLToPath(import.meta.url));
const projectPath = join(here, "../mp");
const CLI_PATH = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const useTool = process.argv.includes("--tool");

const log = (...a) => console.log("[sim]", ...a);

async function main() {
  const port = 9400 + Math.floor(Math.random() * 500);
  const miniProgram = await automator.launch({ cliPath: CLI_PATH, projectPath, port });
  log("launched");
  try {
    // 设置 prompt（tool 模式改词）
    if (useTool) {
      await miniProgram.evaluate(() => {
        const pages = getCurrentPages();
        pages[pages.length - 1].setData({
          prompt: "What is the weather in Tokyo right now? You must call the get_weather tool, then answer briefly.",
        });
      });
    }
    await miniProgram.evaluate(() => {
      const pages = getCurrentPages();
      pages[pages.length - 1].onSend();
    });
    const deadline = Date.now() + 120_000;
    let fxTest = null;
    while (Date.now() < deadline) {
      fxTest = await miniProgram.evaluate(() => getApp()?.globalData?.fxTest ?? null);
      if (fxTest && (fxTest.phase === "done" || fxTest.phase === "error")) break;
      await new Promise((r) => setTimeout(r, 1000));
      process.stdout.write(".");
    }
    console.log("");
    log("fxTest:", JSON.stringify({ ...fxTest, text: (fxTest?.text || "").slice(0, 300) }, null, 1));
    if (fxTest?.phase === "done") { log("PASS"); return 0; }
    log("FAIL:", fxTest?.error || "timeout/phase=" + fxTest?.phase);
    return 1;
  } finally {
    await miniProgram.close().catch(() => {});
  }
}

process.exit(await main());
