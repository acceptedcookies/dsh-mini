// AB-S3 — DevTools 模拟器内真实量级 fx wasm 字节管线 + 分段耗时 (V-A4, V-A5)
// fixtures/fx-core-async.wasm 缺席 → NOT_RUN（--build 从 fx-wasm-agent 拷入）。
import { join } from "node:path";
import { existsSync } from "node:fs";
import { startMockWasm } from "../lib/wasm-server.mjs";
import { launchSpikeMp, setTargetConfig, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";
import { assertProbeResultShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const { spikeDir, row } = ctx;
  const mpDir = join(spikeDir, "mp");
  const fxFixture = join(spikeDir, "fixtures", "fx-core-async.wasm");
  if (!existsSync(fxFixture)) {
    return {
      verdict: "NOT_RUN",
      reason: "fixtures/fx-core-async.wasm absent; run `node harness/run.mjs --build` with fx-wasm-agent fixture present",
    };
  }
  const mock = await startMockWasm({ fixturesDir: join(spikeDir, "fixtures") });
  let miniProgram;
  try {
    try {
      miniProgram = await launchSpikeMp(mpDir);
    } catch (e) {
      return { verdict: "NOT_RUN", reason: `automator launch failed: ${(e && e.message) || e}` };
    }
    const device = await deviceInfo(miniProgram);
    await setTargetConfig(miniProgram, { base: mock.url, arms: row.arms });
    const result = await grabProbeResult(miniProgram, { timeoutMs: 180_000 });
    if (!result || result.fatal) {
      return { verdict: "RED", reason: result?.fatal ? `probe fatal: ${result.fatal}` : "no probe result within 180s", device };
    }
    const shapeErr = assertProbeResultShape(result);
    if (shapeErr) {
      return { verdict: "RED", reason: `probe result shape invalid: ${shapeErr}`, device };
    }
    const f = result.fxReal ?? {};
    const stats = result.stats ?? {};
    const plants = [
      { id: "P-stub-quiet", fired: f.stubCalls === 0 && f.instanceOk === true, restored: f.moduleOk === true },
    ];
    const checks = {
      moduleOk: f.moduleOk === true,
      instanceOk: f.instanceOk === true,
      stubQuiet: f.stubCalls === 0,
      hasMemory: f.hasMemory === true,
      hasAsyncify: f.hasAsyncify === true,
      importsPositive: typeof f.imports === "number" && f.imports > 0,
      importsAllFn: f.importKinds
        ? Object.keys(f.importKinds).length > 0 && Object.entries(f.importKinds).every(([k]) => k === "function")
        : false,
      // byte-level integrity of the decrypted 4MB payload (engine-check parity)
      fnvMatch: f.fnvMatch === true,
      fromMock: result.baseHost === `127.0.0.1:${mock.port}`,
    };
    const budgetUsed = { objects: 3, ops: stats.httpOps ?? null, bytes: stats.httpBytes ?? null };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `fx real pipeline checks failed: ${failed.join(",")} (${f.error || f.compileErr || f.linkErr || f.stubErr || f.introspectErr || ""})`,
        counts: { imports: f.imports ?? null, plainBytes: f.plainBytes ?? null },
        plants,
        budgetUsed,
        device,
        detail: { cryptoProbe: result.cryptoProbe, fxReal: f, mock: { bind: mock.bind, port: mock.port } },
      };
    }
    return {
      verdict: "PASS",
      reason:
        "simulator: ~4MB fx-core-async ciphertext fetched, decrypted (fnv-verified), Module compiled and stub Instance linked inside WXWebAssembly — stubs never called. compile+link only; runnability is a composition inference (see charter V-A4)",
      counts: { imports: f.imports, plainBytes: f.plainBytes },
      plants,
      budgetUsed,
      device,
      detail: {
        cryptoProbe: result.cryptoProbe,
        timings: {
          fetchMs: f.fetchMs ?? null,
          decryptMs: f.decryptMs ?? null,
          compileMs: f.compileMs ?? null,
          linkMs: f.linkMs ?? null,
          totalMs: f.totalMs ?? null,
          armWallMs: f.armWallMs ?? null,
        },
        importKinds: f.importKinds ?? null,
        fnv: { expected: f.fnvExpected, actual: f.fnvActual },
        mock: { bind: mock.bind, port: mock.port },
      },
    };
  } finally {
    await closeMp(miniProgram);
    await mock.close();
  }
}
