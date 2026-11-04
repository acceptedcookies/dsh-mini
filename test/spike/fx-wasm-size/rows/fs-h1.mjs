// FS-H1 — 基准字节数 + 节区普查 (V-S1, V-S2)
import { join } from "node:path";
import { ensureCoreWasm } from "../lib/fetch-libfx.mjs";
import { sectionCensus, censusSummary } from "../lib/sections.mjs";
import { binaryenCrossCheck } from "../ref/section-check.mjs";
import { SUBPACKAGE_LIMIT } from "../ledger.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fetched = ensureCoreWasm(spikeDir);
  const census = sectionCensus(fetched.path);
  const cross = binaryenCrossCheck(fetched.path);
  const overBy = fetched.bytes - SUBPACKAGE_LIMIT;
  return {
    verdict: "PASS",
    reason:
      overBy <= 0
        ? `fx-core.wasm fits subpackage (${fetched.bytes} <= ${SUBPACKAGE_LIMIT})`
        : `fx-core.wasm exceeds subpackage limit by ${overBy} bytes (${((overBy / SUBPACKAGE_LIMIT) * 100).toFixed(1)}%)`,
    counts: {
      bytes: fetched.bytes,
      limit: SUBPACKAGE_LIMIT,
      overBy,
      fitsSubpackage: overBy <= 0 ? 1 : 0,
      numFunctions: cross.numFunctions,
      numExports: cross.numExports,
      numImports: cross.numImportsApi,
    },
    remoteOps: fetched.remoteOps,
    detail: {
      sha256: fetched.sha256,
      tarball: fetched.tarball ?? "cached",
      cached: fetched.cached,
      sections: census.sections.map((s) => ({
        name: s.id === 0 ? `custom:${s.customName}` : s.name,
        size: s.size,
        pct: ((s.size / census.total) * 100).toFixed(2),
      })),
      byName: censusSummary(census),
    },
  };
}
