// FS-H3 — wasm-metadce 保留集下界估算 (V-S4)
// 根集 = libfx wasm runtime 实际触达的导出: memory + _start + asyncify_*。
// 结果是对「Zig feature-gate 后体积下界」的代理估计, 不是可运行产物承诺。
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { statSync, writeFileSync, readFileSync } from "node:fs";
import { ensureCoreWasm } from "../lib/fetch-libfx.mjs";
import { SUBPACKAGE_LIMIT } from "../ledger.mjs";

const require = createRequire(import.meta.url);
const METADCE = join(dirname(require.resolve("binaryen/package.json")), "bin", "wasm-metadce");

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fetched = ensureCoreWasm(spikeDir);
  const graphPath = join(spikeDir, "fixtures", "metadce-graph.json");
  const outPath = join(spikeDir, "fixtures", "fx-core-metadce.bin");

  const exports = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(fetched.path))).map(
    (e) => e.name,
  );
  const roots = exports.filter((n) => n === "_start" || n === "memory" || n.startsWith("asyncify_"));
  const graph = roots.map((name) => ({ name: fetched.path, export: name, root: true }));
  writeFileSync(graphPath, JSON.stringify(graph));
  execFileSync("node", [METADCE, "--all-features", fetched.path, "--graph-file", graphPath, "-o", outPath], {
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024,
  });
  const bytes = statSync(outPath).size;
  const fits = bytes <= SUBPACKAGE_LIMIT;
  return {
    verdict: "PASS",
    reason:
      `metadce(roots=${roots.join(",")}) -> ${bytes}B ` +
      (fits
        ? "entry-rooted module fits subpackage — Zig-side gating plausibly reaches the limit"
        : "even entry-rooted estimate exceeds the limit — split or deeper surgery required"),
    counts: {
      baseline: fetched.bytes,
      metadceBytes: bytes,
      fitsSubpackage: fits ? 1 : 0,
      rootsKept: roots.length,
      exportsTotal: exports.length,
    },
    remoteOps: fetched.remoteOps,
    detail: {
      roots,
      caveat: "lower-bound proxy; module may not run — it sizes the code+data reachable from entry",
    },
  };
}
