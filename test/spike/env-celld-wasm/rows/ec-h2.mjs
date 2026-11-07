// EC-H2 — Node WebAssembly 臂：实例化 + 转录对照 + 尺寸计量 (V-E2, V-E4)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { driveNode, firstDiff, goldenPath, wasmPath } from "../lib/node-drive.mjs";
import { parseTranscript, assertTranscriptShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const plants = [];
  const wp = wasmPath(spikeDir);
  const gp = goldenPath(spikeDir);
  if (!existsSync(wp) || !existsSync(gp)) {
    return { verdict: "NOT_RUN", reason: "build artifacts missing — run `node harness/run.mjs --build` (or EC-H1) first" };
  }
  const golden = readFileSync(gp, "utf8");

  let drove;
  try {
    drove = await driveNode(spikeDir);
  } catch (e) {
    return { verdict: "RED", reason: `node wasm drive threw: ${(e && e.stack) || e}`, plants };
  }
  const { transcript, stats } = drove;

  // P-empty-transcript: 空转录必须被判 invalid（探针鉴别力自证）
  const emptyParse = parseTranscript("");
  plants.push({ id: "P-empty-transcript", fired: emptyParse.error !== undefined, restored: true });

  // P-golden-corrupt: 篡改 golden 必须被判 mismatch（对照器鉴别力自证）
  const corrupt = golden.replace('"completed_local":true', '"completed_local":false');
  const corruptDiff = firstDiff(transcript, corrupt) !== -1 || transcript !== corrupt;
  plants.push({ id: "P-golden-corrupt", fired: corruptDiff, restored: true });

  // 结构断言（独立实现 ref/probe-spec）
  const parsed = parseTranscript(transcript);
  if (parsed.error) {
    return { verdict: "RED", reason: `transcript shape invalid: ${parsed.error}`, counts: stats, plants };
  }
  const shapeErr = assertTranscriptShape(parsed.doc);
  if (shapeErr) {
    return { verdict: "RED", reason: `transcript shape invalid: ${shapeErr}`, counts: stats, plants };
  }

  // V-E2: 与原生 golden 逐字节一致
  const diffAt = firstDiff(transcript, golden);
  const byteExact = diffAt === -1;

  // V-E4: 尺寸计量 —— wasm + brotli（WXWebAssembly 原生支持 .wasm.br）
  const wasmBytes = readFileSync(wp);
  const brBytes = brotliCompressSync(wasmBytes, { quality: 11 });
  const size = {
    wasmBytes: wasmBytes.length,
    wasmBrBytes: brBytes.length,
    brRatio: +(brBytes.length / wasmBytes.length).toFixed(4),
    memoryBytesAfter: stats.memoryBytesAfter,
    importCount: stats.importCount,
    compileInstantiateMs: stats.compileInstantiateMs,
    runMs: stats.runMs,
  };

  const checks = {
    zeroImports: stats.importCount === 0,
    memoryExported: stats.exportNames.includes("memory"),
    byteExact,
    completedLocal: parsed.doc.tail.completed_local === true,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) {
    return {
      verdict: "RED",
      reason: `checks failed: ${failed.join(",")}${byteExact ? "" : ` (first diff @${diffAt})`}`,
      counts: size,
      plants,
      detail: { diffAt, transcriptHead: transcript.slice(0, 200) },
    };
  }
  return {
    verdict: "PASS",
    reason: `node wasm: transcript byte-exact vs native golden (${stats.transcriptBytes}B); ${size.wasmBytes}B wasm / ${size.wasmBrBytes}B br; 0 imports; memory ${stats.memoryBytesAfter}B`,
    counts: size,
    timing: { diagnostic: true, samples: 1, unit: "ms", compileInstantiateMs: stats.compileInstantiateMs, runMs: stats.runMs },
    plants,
    detail: { steps: parsed.doc.tail.steps },
  };
}
