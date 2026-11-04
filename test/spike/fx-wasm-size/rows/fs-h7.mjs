// FS-H7 — builtin_tools 翻转零增量实验 (V-S7)
// 把 context/fx/build.zig 的 wasm builtin_tools=true 临时改为 false, 构建,
// 与 baseline 对比字节数。finally 必还原 —— 这是参考系上的可逆测试, 不是施工。
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zigAvailable, buildCore } from "../lib/zig-build.mjs";

const BUILD_ZIG = "/Users/seanz/Documents/dsh-mini/context/fx/build.zig";
const ORIGINAL = 'wasm_options.addOption(bool, "builtin_tools", true);';
const PATCHED = 'wasm_options.addOption(bool, "builtin_tools", false);';

export async function run(ctx) {
  const { spikeDir } = ctx;
  const zig = zigAvailable();
  if (!zig.ok) {
    return {
      verdict: "NOT_RUN",
      reason: "zig toolchain not installed — flag-flip build lane unavailable",
      counts: {},
      detail: { needs: "zig 0.17+" },
    };
  }
  const baselinePath = join(spikeDir, "fixtures", "fx-core-src.wasm");
  if (!existsSync(baselinePath)) {
    return {
      verdict: "NOT_RUN",
      reason: "needs FS-H5's source-built baseline (fixtures/fx-core-src.wasm) first",
      counts: {},
    };
  }

  const originalText = readFileSync(BUILD_ZIG, "utf8");
  if (!originalText.includes(ORIGINAL)) {
    return {
      verdict: "RED",
      reason: "build.zig no longer contains the expected builtin_tools line — patch anchor stale",
      counts: {},
    };
  }
  let built;
  try {
    writeFileSync(BUILD_ZIG, originalText.replace(ORIGINAL, PATCHED));
    built = buildCore(spikeDir, { tag: "notools" });
  } finally {
    writeFileSync(BUILD_ZIG, originalText);
  }

  const baseline = statSync(baselinePath).size;
  const delta = built.bytes - baseline;
  return {
    verdict: "PASS",
    reason:
      `builtin_tools=false build: ${built.bytes}B vs baseline ${baseline}B, ` +
      `delta ${delta}B — ` +
      (delta === 0
        ? "flag is a NO-OP on the wasm surface: tool registry already dead weight there"
        : "flag produces a real delta — tool layer cost is live in wasm artifact"),
    counts: {
      baselineBytes: baseline,
      noToolsBytes: built.bytes,
      flagDelta: delta,
    },
    remoteOps: 0,
    detail: {
      patch: `${ORIGINAL} -> builtin_tools=false, restored after build`,
      interpretation:
        "wasm surface runs host tools via fx_host_tool_call; builtin registry may " +
        "be emitted-but-dead in both modes — a zero delta means the flag is not a " +
        "size lever for the Mini Program artifact",
    },
  };
}
