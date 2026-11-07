// EC-S1 — DevTools 模拟器 WXWebAssembly 臂 (V-E3)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { launchSpikeMp, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";
import { goldenPath } from "../lib/node-drive.mjs";
import { firstDiff } from "../lib/node-drive.mjs";
import { parseTranscript, assertTranscriptShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const mpDir = join(spikeDir, "mp");
  const gp = goldenPath(spikeDir);
  if (!existsSync(gp)) {
    return { verdict: "NOT_RUN", reason: "golden missing — run EC-H1/--build first" };
  }
  const golden = readFileSync(gp, "utf8");

  let miniProgram;
  try {
    miniProgram = await launchSpikeMp(mpDir);
  } catch (e) {
    return {
      verdict: "NOT_RUN",
      reason: `automator launch failed: ${(e && e.message) || e}`,
      detail: { hint: "devtools service port may be disabled or first-run dialog pending" },
    };
  }
  try {
    const device = await deviceInfo(miniProgram);
    const result = await grabProbeResult(miniProgram);
    if (!result) {
      return { verdict: "RED", reason: "probe page produced no result within 30s", device };
    }
    if (result.fatal) {
      return { verdict: "RED", reason: `probe page fatal: ${result.fatal}`, device };
    }

    const plants = [];
    // P-wasm-bad: bad module must have thrown inside the page.
    plants.push({ id: "P-wasm-bad", fired: result.bad?.threw === true, restored: true });

    const celld = result.celld ?? {};
    const transcript = celld.transcript;
    const parsed = parseTranscript(transcript);
    if (parsed.error) {
      return { verdict: "RED", reason: `sim transcript invalid: ${parsed.error}`, device, plants, detail: { celld } };
    }
    const shapeErr = assertTranscriptShape(parsed.doc);
    if (shapeErr) {
      return { verdict: "RED", reason: `sim transcript shape invalid: ${shapeErr}`, device, plants, detail: { celld } };
    }

    // P-golden-corrupt: 篡改 golden 必须判 mismatch（对照器鉴别力）
    const corrupt = golden.replace('"completed_local":true', '"completed_local":false');
    plants.push({ id: "P-golden-corrupt", fired: transcript !== corrupt, restored: true });

    const diffAt = firstDiff(transcript ?? "", golden);
    const byteExact = diffAt === -1;

    const checks = {
      wxWasmPresent: result.apiSurface?.wxWasm === "object" || result.apiSurface?.wxWasm === "function",
      instantiateOk: celld.instantiateOk === true,
      badThrew: result.bad?.threw === true,
      byteExact,
      completedLocal: parsed.doc.tail.completed_local === true,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `checks failed: ${failed.join(",")}${byteExact ? "" : ` (first diff @${diffAt})`}`,
        device,
        plants,
        detail: { apiSurface: result.apiSurface, celld, diffAt },
      };
    }
    return {
      verdict: "PASS",
      reason: `WXWebAssembly instantiated celld-logic wasm and produced byte-exact transcript vs native golden (${(transcript ?? "").length}B, ${parsed.doc.tail.steps} steps)`,
      counts: {
        transcriptBytes: (transcript ?? "").length,
        steps: parsed.doc.tail.steps,
        memoryBytes: celld.memoryBytes ?? null,
        instantiateMs: celld.instantiateMs ?? null,
      },
      plants,
      device,
      detail: { apiSurface: result.apiSurface, celld: { ...celld, transcript: undefined } },
    };
  } finally {
    await closeMp(miniProgram);
  }
}
