// FS-H6 — import 族调用图归属普查 (V-S6)
// 在真实工件上解析 code 段: 每个函数可达哪些 import 族 (fx_http / fx_session /
// wasi_fs ...)。给包清单提供「按宿主能力族的字节归属」实测, 不靠文件名猜。
// 保守性地板: call_indirect 目标静态不可解, 计数进 receipt。
import { readFileSync } from "node:fs";
import { ensureCoreWasm } from "../lib/fetch-libfx.mjs";
import { attribute } from "../lib/callgraph.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fetched = ensureCoreWasm(spikeDir);
  const buf = readFileSync(fetched.path);
  const r = attribute(buf, fetched.path);

  const pct = (n) => Math.round((n / r.totalCode) * 1000) / 10;
  const fams = Object.keys(r.inclusive).sort((a, b) => r.inclusive[b] - r.inclusive[a]);
  const coverageOk = r.indirectCalls >= 0 && r.definedFunctions > 0;
  const lines = fams.map(
    (f) =>
      `${f} incl=${r.inclusive[f]}B(${pct(r.inclusive[f])}%) excl=${r.exclusive[f] ?? 0}B`,
  );
  return {
    verdict: coverageOk ? "PASS" : "RED",
    reason:
      `attribution over ${r.definedFunctions} fns: ` +
      `top family ${fams[0]}=${r.inclusive[fams[0]]}B (${pct(r.inclusive[fams[0]])}% incl); ` +
      `engine-core (no import reach) ${r.unattributed}B; ` +
      `shared multi-family ${r.multiFamily}B; ${r.indirectCalls} call_indirect sites`,
    counts: {
      totalCode: r.totalCode,
      definedFunctions: r.definedFunctions,
      callIndirectSites: r.indirectCalls,
      engineUnattributedBytes: r.unattributed,
      sharedMultiFamilyBytes: r.multiFamily,
      ...Object.fromEntries([
        ...fams.map((f) => [`incl_${f}`, r.inclusive[f]]),
        ...fams.map((f) => [`excl_${f}`, r.exclusive[f] ?? 0]),
      ]),
    },
    remoteOps: fetched.remoteOps,
    detail: {
      families: fams,
      familyFunctionCounts: r.familyMembers,
      method:
        "direct-call reachability from each of 55 imports; call_indirect targets " +
        "unresolvable — attribution is a floor, not a ceiling",
      lines,
    },
  };
}
