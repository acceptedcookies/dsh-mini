// Zig source-build driver for the fx checkout under context/fx.
// All outputs redirect into this spike's fixtures/ — context/fx stays clean
// (no zig-out, no .zig-cache). Reversible-test use only.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const FX_REPO = "/Users/seanz/Documents/dsh-mini/context/fx";

export function zigAvailable() {
  try {
    const v = execFileSync("zig", ["version"], { stdio: "pipe" }).toString().trim();
    return { ok: true, version: v };
  } catch {
    return { ok: false };
  }
}

// Build `zig build -Dwasm-surface=core [extraOpts]` with caches under
// fixtures/zig-cache and prefix under fixtures/zig-out-<tag>.
export function buildCore(spikeDir, { extraOpts = [], tag = "src" } = {}) {
  const cacheDir = join(spikeDir, "fixtures", "zig-cache", "local");
  const globalDir = join(spikeDir, "fixtures", "zig-cache", "global");
  const prefix = join(spikeDir, "fixtures", `zig-out-${tag}`);
  execFileSync("zig", ["build", "-Dwasm-surface=core", ...extraOpts, "--prefix", prefix], {
    cwd: FX_REPO,
    env: {
      ...process.env,
      ZIG_LOCAL_CACHE_DIR: cacheDir,
      ZIG_GLOBAL_CACHE_DIR: globalDir,
    },
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  const wasm = join(prefix, "bin", "fx-core.wasm");
  if (!existsSync(wasm)) throw new Error(`build produced no artifact at ${wasm}`);
  const dest = join(spikeDir, "fixtures", `fx-core-${tag}.wasm`);
  cpSync(wasm, dest);
  return { path: dest, bytes: statSync(dest).size };
}

// Run the shipped optimize pass (sdk/scripts/optimize-wasm.mjs equivalent)
// on an artifact and return its byte count.
export function optimize(inputPath, outputPath) {
  const require = createRequire(import.meta.url);
  const WASM_OPT = join(
    dirname(require.resolve("binaryen/package.json")),
    "bin",
    "wasm-opt",
  );
  const features = [
    "bulk-memory-opt",
    "call-indirect-overlong",
    "extended-const",
    "multivalue",
    "mutable-globals",
    "nontrapping-float-to-int",
    "sign-ext",
  ];
  execFileSync(
    "node",
    [
      WASM_OPT,
      inputPath,
      "-Oz",
      "--strip-debug",
      "--strip-producers",
      ...features.map((f) => `--enable-${f}`),
      "-o",
      outputPath,
    ],
    { stdio: "pipe", maxBuffer: 256 * 1024 * 1024 },
  );
  return statSync(outputPath).size;
}
