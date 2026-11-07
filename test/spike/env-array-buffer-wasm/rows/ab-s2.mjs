// AB-S2 — DevTools 模拟器内加密下发管线 echo 量级 (V-A3, V-A5)
import { join } from "node:path";
import { existsSync } from "node:fs";
import { startMockWasm } from "../lib/wasm-server.mjs";
import { launchSpikeMp, setTargetConfig, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";
import { assertProbeResultShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const { spikeDir, row } = ctx;
  const mpDir = join(spikeDir, "mp");
  if (!existsSync(join(spikeDir, "fixtures", "echo.wasm"))) {
    return { verdict: "NOT_RUN", reason: "fixtures/echo.wasm missing; run `node harness/run.mjs --build` first" };
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
    const result = await grabProbeResult(miniProgram, { timeoutMs: 120_000 });
    if (!result || result.fatal) {
      return { verdict: "RED", reason: result?.fatal ? `probe fatal: ${result.fatal}` : "no probe result within 120s", device };
    }
    const shapeErr = assertProbeResultShape(result);
    if (shapeErr) {
      return { verdict: "RED", reason: `probe result shape invalid: ${shapeErr}`, device };
    }
    const e = result.encPipeline ?? {};
    const stats = result.stats ?? {};
    const plants = [
      { id: "P-wrong-key", fired: e.wrongKeyThrew === true, restored: e.ok === true && e.value === 42 },
      { id: "P-trunc-wasm", fired: e.truncThrew === true, restored: e.ok === true && e.value === 42 },
      {
        id: "P-valid-swap",
        fired: e.validSwapNotRejected === true,
        restored: e.ok === true && e.value === 42,
      },
    ];
    const checks = {
      encOk: e.ok === true && e.value === 42,
      roundtripEq: e.roundtripEq === true,
      wrongKeyThrew: e.wrongKeyThrew === true,
      truncThrew: e.truncThrew === true,
      // engine must NOT reject a valid-but-wrong module — proves Module checks
      // format, not integrity (MAC/length verification is a design requirement)
      validSwapNotRejected: e.validSwapNotRejected === true,
      fromMock: result.baseHost === `127.0.0.1:${mock.port}`,
    };
    const budgetUsed = { objects: 3, ops: stats.httpOps ?? null, bytes: stats.httpBytes ?? null };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `enc pipeline checks failed: ${failed.join(",")} (${e.error || ""})`,
        counts: { value: e.value ?? null },
        plants,
        budgetUsed,
        device,
        detail: { cryptoProbe: result.cryptoProbe, encPipeline: e, mock: { bind: mock.bind, port: mock.port } },
      };
    }
    return {
      verdict: "PASS",
      reason:
        "simulator: fetch ciphertext -> in-memory decrypt -> Module(ab) -> Instance -> echo()=42; wrong-key/truncated ciphertext rejected with recorded error names; valid-but-wrong module NOT rejected by engine (integrity is a caller responsibility)",
      counts: { value: e.value, encBytes: e.plainBytes ?? null },
      plants,
      budgetUsed,
      device,
      detail: {
        cryptoProbe: result.cryptoProbe,
        timings: {
          fetchMs: e.fetchMs ?? null,
          decryptMs: e.decryptMs ?? null,
          compileMs: e.compileMs ?? null,
          linkMs: e.linkMs ?? null,
          totalMs: e.totalMs ?? null,
        },
        errorNames: { wrongKey: e.wrongKeyName ?? null, trunc: e.truncName ?? null, validSwap: e.validSwapName ?? null },
        mock: { bind: mock.bind, port: mock.port },
      },
    };
  } finally {
    await closeMp(miniProgram);
    await mock.close();
  }
}
