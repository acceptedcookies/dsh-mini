// EC-R1 — iOS 真机 WXWebAssembly 臂 (V-E3)。与 EC-S1 同判据，证据等级 R1。
// 驱动：automator launch spike mp → remote() → 业主扫码 → 探针跑 → golden 对照。
import { readFileSync, existsSync } from "node:fs";
import { driveDevice } from "../lib/device-drive2.mjs";
import { goldenPath } from "../lib/node-drive.mjs";
import { firstDiff } from "../lib/node-drive.mjs";
import { parseTranscript, assertTranscriptShape } from "../ref/probe-spec.mjs";

const EXPECT_PLATFORM = /ios|iphone|ipad|apple/i;

export async function run(ctx) {
  const { spikeDir } = ctx;
  const gp = goldenPath(spikeDir);
  if (!existsSync(gp)) return { verdict: "NOT_RUN", reason: "golden missing — run EC-H1/--build first" };
  const golden = readFileSync(gp, "utf8");

  const d = await driveDevice(spikeDir);
  if (!d.ok) {
    return { verdict: "NOT_RUN", reason: d.reason, device: d.device ?? null };
  }
  const device = d.device;
  const platform = `${device.brand ?? ""} ${device.model ?? ""} ${device.platform ?? ""} ${device.system ?? ""}`;
  if (!EXPECT_PLATFORM.test(platform)) {
    return {
      verdict: "NOT_RUN",
      reason: `connected device is not iOS (${platform.trim()}) — evidence belongs to EC-R2 lane`,
      device,
      detail: { hint: "run EC-R2 for this device" },
    };
  }

  const result = d.result;
  if (result.fatal) return { verdict: "RED", reason: `probe page fatal: ${result.fatal}`, device };
  const celld = result.celld ?? {};
  const transcript = celld.transcript;
  const parsed = parseTranscript(transcript);
  if (parsed.error) return { verdict: "RED", reason: `device transcript invalid: ${parsed.error}`, device, detail: { celld } };
  const shapeErr = assertTranscriptShape(parsed.doc);
  if (shapeErr) return { verdict: "RED", reason: `device transcript shape invalid: ${shapeErr}`, device };

  const diffAt = firstDiff(transcript ?? "", golden);
  const byteExact = diffAt === -1;
  const checks = {
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
      detail: { celld: { ...celld, transcript: undefined }, diffAt },
    };
  }
  return {
    verdict: "PASS",
    reason: `iOS device WXWebAssembly produced byte-exact transcript vs native golden (${(transcript ?? "").length}B, ${parsed.doc.tail.steps} steps)`,
    counts: { transcriptBytes: (transcript ?? "").length, steps: parsed.doc.tail.steps, memoryBytes: celld.memoryBytes ?? null, instantiateMs: celld.instantiateMs ?? null },
    device,
    detail: { apiSurface: result.apiSurface, celld: { ...celld, transcript: undefined } },
  };
}
