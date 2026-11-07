// EC-H1 — celld-logic 原生编译 + 确定性对照臂 (V-E1, V-E2a)
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const KERNEL = (spikeDir) => join(spikeDir, "kernel");
const CLI = (spikeDir) => join(KERNEL(spikeDir), "target", "release", "probe-cli");
const WASM = (spikeDir) =>
  join(KERNEL(spikeDir), "target", "wasm32-unknown-unknown", "release", "env_celld_probe.wasm");
const GOLDEN = (spikeDir) => join(spikeDir, "fixtures", "golden-transcript.txt");

function cargo(args, cwd) {
  return execSync(`cargo ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export async function run(ctx) {
  const { spikeDir } = ctx;
  const plants = [];
  const kdir = KERNEL(spikeDir);

  // V-E1a: native build (probe-cli 对照臂)
  try {
    cargo("build --release --bin probe-cli", kdir);
  } catch (e) {
    return { verdict: "RED", reason: `native build failed: ${(e.stderr || e.message || e).toString().slice(0, 800)}` };
  }
  const cli = CLI(spikeDir);
  if (!existsSync(cli)) return { verdict: "RED", reason: "probe-cli binary missing after build" };

  // V-E2a: 确定性 —— 同一 scenario 连跑两次必须逐字节一致
  const t1 = execSync(cli, { encoding: "utf8" });
  const t2 = execSync(cli, { encoding: "utf8" });
  const deterministic = t1 === t2;
  plants.push({ id: "P-native-nondet", fired: deterministic, restored: deterministic });
  if (!deterministic) {
    return { verdict: "RED", reason: "P-native-nondet: two native runs differ — scenario not deterministic", plants };
  }

  // golden 落盘（fixtures 提交物；wasm 臂对照基准）
  mkdirSync(join(spikeDir, "fixtures"), { recursive: true });
  writeFileSync(GOLDEN(spikeDir), t1);

  // V-E1b: wasm32 cdylib build
  try {
    cargo("build --release --target wasm32-unknown-unknown", kdir);
  } catch (e) {
    return { verdict: "RED", reason: `wasm32 build failed: ${(e.stderr || e.message || e).toString().slice(0, 800)}` };
  }
  const wasm = WASM(spikeDir);
  if (!existsSync(wasm)) return { verdict: "RED", reason: "wasm cdylib missing after build" };
  const wasmBytes = readFileSync(wasm).length;

  // 转录 sanity：冷激活链必须 completed_local
  let tail = null;
  try {
    tail = JSON.parse(t1).tail;
  } catch {}
  const checks = {
    deterministic,
    transcriptParses: tail !== null,
    completedLocal: tail?.completed_local === true,
    stepsReasonable: (tail?.steps ?? 99) <= 50,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) {
    return { verdict: "RED", reason: `native transcript checks failed: ${failed.join(",")}`, counts: { wasmBytes }, plants, detail: { tail } };
  }
  return {
    verdict: "PASS",
    reason: `celld-logic → wasm32-unknown-unknown builds (${wasmBytes}B); native transcript deterministic, cold-activation chain completes Local in ${tail.steps} steps`,
    counts: { wasmBytes, transcriptBytes: t1.length, steps: tail.steps },
    plants,
    detail: { tail, goldenPath: GOLDEN(spikeDir) },
  };
}
