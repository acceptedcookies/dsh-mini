// sweeper 部署器：config.json 只持触发器/超时；TICKET_SECRET 属密钥（.env.wx.cloud，gitignored），
// 部署期注入 envVariables → CLI 部署 → 还原 config.json（密钥永不落盘到 tracked 文件）。
// 端点默认已内嵌代码（DURABLE_WORKER_URL/BYOK_PROXY_URL 非密钥），env 仅注 TICKET_SECRET。
// 用法: node scripts/deploy-sweeper.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const cfgPath = join(root, "cloud/functions/sweeper/config.json");

const envFile = {};
for (const line of readFileSync(join(root, ".env.wx.cloud"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) envFile[m[1]] = m[2].trim();
}
if (!envFile.TICKET_SECRET) throw new Error(".env.wx.cloud 缺 TICKET_SECRET");
const ENV_ID = envFile.WX_CLOUD_ENV_ID ?? "cloud1-d7gar8j7w419589a0";

const original = readFileSync(cfgPath, "utf8");
const cfg = JSON.parse(original);
cfg.envVariables = { TICKET_SECRET: envFile.TICKET_SECRET };
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
try {
  const out = execFileSync(CLI, [
    "cloud", "functions", "deploy",
    "--appid", "wx356d3abb52825466", "--env", ENV_ID,
    "--paths", join(root, "cloud/functions/sweeper"),
    "--token", process.env.WECHAT_DEVTOOLS_CLI_TOKEN ?? "gckjyDjGMk0RjhIpXpz706E37mrXw2k8",
  ], { encoding: "utf8", timeout: 300000 });
  console.log(out.split("\n").filter((l) => l.trim()).slice(-10).join("\n"));
} finally {
  writeFileSync(cfgPath, original);
  console.log("[deploy-sweeper] config.json restored (secret not persisted)");
}
