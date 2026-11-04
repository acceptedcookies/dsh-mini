// harness/run.mjs — fx-wasm-stream row driver.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROWS } from "../ledger.mjs";
import { preflight } from "../lib/preflight.mjs";
import { makeReceipt, writeReceipt } from "../lib/envelope.mjs";
import { versions } from "../lib/versions.mjs";

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

function check() {
  const ids = new Set();
  const errors = [];
  for (const r of ROWS) {
    if (ids.has(r.id)) errors.push(`duplicate id ${r.id}`);
    ids.add(r.id);
    if (!r.budget?.stopCondition) errors.push(`${r.id}: missing budget.stopCondition`);
    if (!existsSync(rowFile(r.id))) errors.push(`${r.id}: missing row file`);
    for (const n of r.needs) if (!ROWS.some((x) => x.id === n)) errors.push(`${r.id}: unknown dep ${n}`);
  }
  for (const e of errors) console.error(`check: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check: ${ROWS.length} rows ok`);
}

async function runRow(row) {
  console.log(`=== ${row.id} ${row.name}`);
  const gate = await preflight(row.envClass);
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
else if (arg === "--all") {
  for (const r of [...ROWS].sort((a, b) => a.order - b.order)) await runRow(r);
} else if (arg) {
  const row = ROWS.find((r) => r.id === arg);
  if (!row) {
    console.error(`unknown row ${arg}`);
    process.exit(1);
  }
  await runRow(row);
} else {
  console.log("usage: node harness/run.mjs --plan | --check | <ROWID> | --all");
}
