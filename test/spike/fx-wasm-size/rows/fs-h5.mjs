// FS-H5 — zig 源码构建复核 (V-S5)
// `zig build -Dwasm-surface=core` 真实构建 fx-core.wasm，跑官方 wasm-opt 管线,
// 与 npm  shipped 工件比对 —— 验证「体积结论适用于可从源码复现的产物」。
// 产物全部落在 fixtures/（重定向 prefix/cache），context/fx 不留痕。
import { join } from "node:path";
import { zigAvailable, buildCore, optimize } from "../lib/zig-build.mjs";
import { ensureCoreWasm } from "../lib/fetch-libfx.mjs";
import { SUBPACKAGE_LIMIT } from "../ledger.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const zig = zigAvailable();
  if (!zig.ok) {
    return {
      verdict: "NOT_RUN",
      reason: "zig toolchain not installed — source build lane unavailable",
      counts: {},
      detail: { needs: "zig 0.17+" },
    };
  }
  const built = buildCore(spikeDir, { tag: "src" });
  const optPath = join(spikeDir, "fixtures", "fx-core-src-opt.wasm");
  const optBytes = optimize(built.path, optPath);
  const shipped = ensureCoreWasm(spikeDir);
  const delta = optBytes - shipped.bytes;
  const deltaPct = ((delta / shipped.bytes) * 100).toFixed(2);
  const optFits = optBytes <= SUBPACKAGE_LIMIT;
  return {
    verdict: "PASS",
    reason:
      `zig ${zig.version} build: raw ${built.bytes}B -> wasm-opt ${optBytes}B ` +
      `(vs shipped ${shipped.bytes}B, delta ${delta}B / ${deltaPct}%) — ` +
      (optFits
        ? "source-built artifact fits"
        : "source-built artifact still exceeds subpackage limit"),
    counts: {
      zigRawBytes: built.bytes,
      zigOptBytes: optBytes,
      shippedBytes: shipped.bytes,
      optVsShippedDelta: delta,
      optFitsSubpackage: optFits ? 1 : 0,
      optShrinkPct: Math.round(((built.bytes - optBytes) / built.bytes) * 100),
    },
    remoteOps: 0,
    detail: {
      zigVersion: zig.version,
      build: "zig build -Dwasm-surface=core (prefix/cache redirected under fixtures/)",
      optimize: "official pass: -Oz --strip-debug --strip-producers + 7 feature gates",
    },
  };
}
