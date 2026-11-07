// harness/run.mjs — spike row driver.
// Usage: node harness/run.mjs --plan | --check | --build | <ROWID> | --all
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { brotliCompressSync } from "node:zlib";
import { ROWS } from "../ledger.mjs";
import { preflight } from "../lib/preflight.mjs";
import { makeReceipt, writeReceipt } from "../lib/envelope.mjs";
import { versions } from "../lib/versions.mjs";

const spikeDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(spikeDir, "..", "..", "..");
const kernelDir = join(spikeDir, "kernel");
const wasmOut = join(kernelDir, "target", "wasm32-unknown-unknown", "release", "env_celld_probe.wasm");
const cliOut = join(kernelDir, "target", "release", "probe-cli");

const rowFile = (id) => join(spikeDir, "rows", `${id.toLowerCase()}.mjs`);

function plan() {
  for (const r of [...ROWS].sort((a, b) => a.order - b.order)) {
    const deps = r.needs.length ? ` <- ${r.needs.join(",")}` : "";
    const gate = r.deferred ? ` [${r.deferred}]` : "";
    console.log(`${r.id}  ${r.lane.padEnd(6)} ${r.grade}  ${r.name}${deps}${gate}`);
  }
}

function check() {
  const ids = new Set();
  const errors = [];
  for (const r of ROWS) {
    if (ids.has(r.id)) errors.push(`duplicate id ${r.id}`);
    ids.add(r.id);
    if (!r.budget?.stopCondition) errors.push(`${r.id}: missing budget.stopCondition`);
    if (!r.lane || !r.grade || !r.envClass) errors.push(`${r.id}: missing lane/grade/envClass`);
    if (!existsSync(rowFile(r.id))) errors.push(`${r.id}: missing row file ${rowFile(r.id)}`);
    for (const n of r.needs) if (!ROWS.some((x) => x.id === n)) errors.push(`${r.id}: unknown dep ${n}`);
  }
  for (const e of errors) console.error(`check: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check: ${ROWS.length} rows ok`);
}

function cargo(args, cwd = kernelDir) {
  return execSync(`cargo ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function build() {
  // 1) wasm32 cdylib
  cargo("build --release --target wasm32-unknown-unknown");
  if (!existsSync(wasmOut)) throw new Error(`wasm missing at ${wasmOut}`);
  // 2) native 对照臂 → golden 转录
  cargo("build --release --bin probe-cli");
  if (!existsSync(cliOut)) throw new Error(`probe-cli missing at ${cliOut}`);
  const golden = execSync(cliOut, { encoding: "utf8" });
  const goldenPath = join(spikeDir, "fixtures", "golden-transcript.txt");
  mkdirSync(join(spikeDir, "fixtures"), { recursive: true });
  writeFileSync(goldenPath, golden);
  // 3) 拷入 mp/wasm + brotli 副本（WXWebAssembly 原生支持 .wasm.br）
  const mpWasm = join(spikeDir, "mp", "wasm");
  mkdirSync(mpWasm, { recursive: true });
  copyFileSync(wasmOut, join(mpWasm, "celld-probe.wasm"));
  const raw = readFileSync(wasmOut);
  writeFileSync(join(mpWasm, "celld-probe.wasm.br"), brotliCompressSync(raw, { quality: 11 }));
  // 4) bad.wasm 镜像（缺 import 必须拒绝）：复用 fx-wasm-jspi 已生成的同型产物
  const badSrc = join(repoRoot, "test", "spike", "fx-wasm-jspi", "mp", "wasm", "bad.wasm");
  if (existsSync(badSrc)) copyFileSync(badSrc, join(mpWasm, "bad.wasm"));
  console.log(`build: celld-probe.wasm ${raw.length}B, golden ${golden.length}B -> ${goldenPath}`);
}

async function runRow(row) {
  console.log(`=== ${row.id} ${row.name}`);
  const gate = preflight(row.envClass);
  let result;
  if (!gate.ok) {
    result = { verdict: "NOT_RUN", reason: gate.reason };
  } else {
    const mod = await import(rowFile(row.id));
    try {
      result = await mod.run({ spikeDir, repoRoot, row });
    } catch (e) {
      result = { verdict: "RED", reason: `row threw: ${(e && e.stack) || e}` };
    }
    if (gate.device) result.device = gate.device;
  }
  const receipt = makeReceipt(row, { ...result, cwd: repoRoot });
  receipt.versions = versions();
  const file = writeReceipt(spikeDir, receipt);
  console.log(`${row.id}: ${receipt.verdict} — ${receipt.reason || ""}`);
  console.log(`  receipt: ${file}`);
  return receipt;
}

const arg = process.argv[2];
if (arg === "--plan") plan();
else if (arg === "--check") check();
else if (arg === "--build") await build();
else if (arg === "--all") {
  const seen = new Set();
  for (const r of [...ROWS].sort((a, b) => a.order - b.order)) {
    for (const n of r.needs) {
      if (!seen.has(n)) console.log(`(dep ${n} not yet run this invocation)`);
    }
    await runRow(r);
    seen.add(r.id);
  }
} else if (arg) {
  const row = ROWS.find((r) => r.id === arg);
  if (!row) {
    console.error(`unknown row ${arg}`);
    process.exit(1);
  }
  await runRow(row);
} else {
  console.log("usage: node harness/run.mjs --plan | --check | --build | <ROWID> | --all");
}
