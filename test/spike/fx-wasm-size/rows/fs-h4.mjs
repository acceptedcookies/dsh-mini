// FS-H4 — P-size-fat 镜像: 测量器自证
import { join } from "node:path";
import { ensureCoreWasm } from "../lib/fetch-libfx.mjs";
import { fatten } from "../fixtures/fatten.mjs";
import { sectionCensus } from "../lib/sections.mjs";
import { SUBPACKAGE_LIMIT } from "../ledger.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fetched = ensureCoreWasm(spikeDir);
  const fatPath = join(spikeDir, "fixtures", "fx-core-fat.bin");
  fatten(fetched.path, fatPath);
  const census = sectionCensus(fatPath);
  const fatSection = census.sections.find((s) => s.customName === "spike-fat");
  const fired = census.total > SUBPACKAGE_LIMIT && !!fatSection;
  return {
    verdict: fired ? "PASS" : "RED",
    reason: fired
      ? `meter honestly reports ${census.total}B > limit and lists the planted custom section`
      : "meter failed to report the fattened module or the planted section",
    counts: { total: census.total, limit: SUBPACKAGE_LIMIT, fatSectionBytes: fatSection?.size ?? 0 },
    plants: [{ id: "P-size-fat", fired, restored: true }],
    remoteOps: fetched.remoteOps,
  };
}
