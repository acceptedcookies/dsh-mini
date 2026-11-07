// sim 运行器：automator.launch(spike mp) → 等 probeResult → L3/L4/L1 receipts。
import automator from "miniprogram-automator";
import { join } from "node:path";
import { buildReceipts } from "./receipts.mjs";

const SPIKE = "/Users/seanz/Documents/dsh-mini/test/spike/env-celld-wasm";
const CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";

const main = async () => {
  const port = 9400 + Math.floor(Math.random() * 500);
  const mp = await automator.launch({ cliPath: CLI, projectPath: join(SPIKE, "mp"), port });
  const ev = (src) => mp.evaluate(new Function(`return (${src})()`));
  let r = null;
  const dl = Date.now() + 40_000;
  while (Date.now() < dl) {
    r = await ev(`() => { const a = getApp(); return a && a.globalData ? a.globalData.probeResult : null }`).catch(() => null);
    if (r) break;
    await new Promise((x) => setTimeout(x, 800));
  }
  try { await mp.close(); } catch {}
  if (!r) return console.log(JSON.stringify({ verdict: "NOT_RUN", reason: "probeResult absent in sim" }));
  const out = buildReceipts(r, "ec-s", "automator launch (devtools sim)");
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
};
main().catch((e) => console.log(JSON.stringify({ verdict: "ERROR", reason: String((e && e.message) || e) })));
