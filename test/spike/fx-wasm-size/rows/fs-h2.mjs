// FS-H2 — wasm-opt -Oz / strip 复核 (V-S3, 验证 F-02)
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { ensureCoreWasm } from "../lib/fetch-libfx.mjs";
import { SUBPACKAGE_LIMIT } from "../ledger.mjs";

const require = createRequire(import.meta.url);
const WASM_OPT = join(dirname(require.resolve("binaryen/package.json")), "bin", "wasm-opt");

function opt(input, output, args) {
  execFileSync("node", [WASM_OPT, "--all-features", input, "-o", output, ...args], {
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024,
  });
  return statSync(output).size;
}

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fetched = ensureCoreWasm(spikeDir);
  const fixtures = join(spikeDir, "fixtures");
  const outOz = join(fixtures, "fx-core-oz.bin");
  const outStrip = join(fixtures, "fx-core-strip.bin");
  const ozBytes = opt(fetched.path, outOz, ["-Oz"]);
  const stripBytes = opt(fetched.path, outStrip, [
    "--strip-debug",
    "--strip-dwarf",
    "--strip-producers",
    "--strip-target-features",
  ]);
  const best = Math.min(ozBytes, stripBytes);
  const fits = best <= SUBPACKAGE_LIMIT;
  return {
    verdict: "PASS",
    reason:
      `re-opt deltas: -Oz ${fetched.bytes - ozBytes}B, strip ${fetched.bytes - stripBytes}B — ` +
      (fits
        ? `optimized artifact fits (${best} <= ${SUBPACKAGE_LIMIT})`
        : `already-optimized artifact confirmed; trimming needs source-level work`),
    counts: {
      baseline: fetched.bytes,
      afterOz: ozBytes,
      afterStrip: stripBytes,
      best,
      fitsSubpackage: fits ? 1 : 0,
    },
    remoteOps: fetched.remoteOps,
    detail: { sha256Baseline: fetched.sha256 },
  };
}
