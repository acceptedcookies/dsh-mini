// harness/run.mjs — spike row driver.
// Usage: node harness/run.mjs --plan | --check | --build | <ROWID> | --all
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ROWS } from "../ledger.mjs";
import { preflight } from "../lib/preflight.mjs";
import { makeReceipt, writeReceipt } from "../lib/envelope.mjs";
import { versions } from "../lib/versions.mjs";
import { buildAll } from "../lib/wasm-build.mjs";
import { xorCrypt } from "../lib/transform.mjs";

const spikeDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(spikeDir, "..", "..", "..");

const rowFile = (id) => join(spikeDir, "rows", `${id.toLowerCase()}.mjs`);

function plan() {
  for (const r of [...ROWS].sort((a, b) => a.order - b.order)) {
    const deps = r.needs.length ? ` <- ${r.needs.join(",")}` : "";
    const gate = r.deferred ? ` [${r.deferred}]` : "";
    console.log(`${r.id}  ${r.lane.padEnd(6)} ${r.grade}  ${r.name}${deps}${gate}`);
  }
}

// Byte-equality check between the lib canonical and the mp copy of the
// transform. Divergence is itself a finding, so we catch it before any row
// runs (the mp file is CommonJS in an ESM package — copy to a .cjs temp).
function checkTransformMirror() {
  const tmp = join(tmpdir(), `ab-transform-${process.pid}-${Date.now()}.cjs`);
  try {
    copyFileSync(join(spikeDir, "mp", "probe", "transform.js"), tmp);
    const req = createRequire(import.meta.url);
    const mp = req(tmp);
    const src = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3, 255, 128]);
    for (const label of ["echo", "echo-bad", "fx-core-async"]) {
      const a = xorCrypt(src, label);
      const b = mp.xorCrypt(src, label);
      if (a.length !== b.length || !a.every((v, i) => v === b[i])) {
        return `transform mirror divergence under label "${label}"`;
      }
    }
    return null;
  } finally {
    rmSync(tmp, { force: true });
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
  const mirrorErr = checkTransformMirror();
  if (mirrorErr) errors.push(mirrorErr);
  for (const e of errors) console.error(`check: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check: ${ROWS.length} rows ok; transform mirror verified`);
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
else if (arg === "--build") await buildAll(spikeDir);
else if (arg === "--all") {
  // needs enforcement: a row whose dep ran RED in this invocation is skipped
  // as NOT_RUN(dep <id> RED) — downstream receipts never assert on a broken
  // upstream. First-RED is a legal terminal state per-row; the runner itself
  // still completes independent rows.
  const verdicts = new Map();
  for (const r of [...ROWS].sort((a, b) => a.order - b.order)) {
    const redDep = r.needs.find((n) => verdicts.get(n) === "RED");
    if (redDep) {
      const receipt = makeReceipt(r, {
        verdict: "NOT_RUN",
        reason: `dep ${redDep} RED this invocation`,
        cwd: repoRoot,
      });
      receipt.versions = versions();
      const file = writeReceipt(spikeDir, receipt);
      verdicts.set(r.id, receipt.verdict);
      console.log(`${r.id}: NOT_RUN — dep ${redDep} RED this invocation`);
      console.log(`  receipt: ${file}`);
      continue;
    }
    const receipt = await runRow(r);
    verdicts.set(r.id, receipt.verdict);
    if (receipt.verdict === "RED") {
      console.log(`(${r.id} RED — dependent rows will be skipped this invocation)`);
    }
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
