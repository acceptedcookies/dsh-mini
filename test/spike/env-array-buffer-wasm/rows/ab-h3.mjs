// AB-H3 — 真实量级 fx wasm 宿主基线 (V-A4 host reference, charter §3.3)
// fixtures/fx-core-async.wasm 缺席 → NOT_RUN（--build 从 fx-wasm-agent 拷入）。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { stubImports } from "../lib/stubs.mjs";
import { fnv1a32 } from "../lib/transform.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fxPath = join(spikeDir, "fixtures", "fx-core-async.wasm");
  if (!existsSync(fxPath)) {
    return {
      verdict: "NOT_RUN",
      reason: "fixtures/fx-core-async.wasm absent; run `node harness/run.mjs --build` with fx-wasm-agent fixture present",
    };
  }
  const bytes = readFileSync(fxPath);
  const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const fnv = fnv1a32(bytes);
  const plants = [];

  const compileSamples = [];
  let mod;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    mod = new WebAssembly.Module(bytes);
    compileSamples.push(Math.round((performance.now() - t) * 10) / 10);
  }
  const imports = WebAssembly.Module.imports(mod);
  const exportsDesc = WebAssembly.Module.exports(mod);
  const { obj, kinds, calls } = stubImports(imports);

  const t2 = performance.now();
  let instanceOk = false;
  let linkErr = null;
  try {
    const inst = new WebAssembly.Instance(mod, obj);
    instanceOk = !!(
      inst.exports &&
      inst.exports.memory &&
      typeof inst.exports.asyncify_get_state === "function"
    );
  } catch (e) {
    linkErr = String((e && e.message) || e);
  }
  const linkMs = Math.round((performance.now() - t2) * 10) / 10;

  const nonFn = Object.entries(kinds)
    .filter(([k]) => k !== "function")
    .reduce((a, [, v]) => a + v, 0);
  plants.push({ id: "P-stub-quiet", fired: calls() === 0 && instanceOk, restored: instanceOk });

  const hasMemory = exportsDesc.some((e) => e.kind === "memory");
  const hasStart = exportsDesc.some((e) => e.name === "_start");
  const hasAsyncify = exportsDesc.some((e) => e.name === "asyncify_get_state");
  const importsPositive = imports.length > 0;
  const ok = instanceOk && calls() === 0 && nonFn === 0 && importsPositive && hasMemory && hasAsyncify;
  const budgetUsed = { objects: 1, ops: 3, bytes: bytes.length };
  if (!ok) {
    return {
      verdict: "RED",
      reason: `fx host baseline failed: instanceOk=${instanceOk} linkErr=${linkErr} nonFnImports=${nonFn} imports=${imports.length} hasMemory=${hasMemory} hasAsyncify=${hasAsyncify}`,
      counts: { bytes: bytes.length, imports: imports.length },
      plants,
      budgetUsed,
      detail: { sha, fnv, linkErr, kinds, compileSamples, linkMs },
    };
  }
  return {
    verdict: "PASS",
    reason:
      "real ~4MB fx wasm: Module compile x3 + stub Instance link OK on host; stubs never called; fnv baseline registered for device-lane integrity parity",
    counts: { bytes: bytes.length, imports: imports.length },
    plants,
    budgetUsed,
    timing: { diagnostic: true, samples: compileSamples, unit: "ms" },
    detail: { sha, fnv, compileMsSamples: compileSamples, linkMs, kinds, hasMemory, hasStart, hasAsyncify },
  };
}
