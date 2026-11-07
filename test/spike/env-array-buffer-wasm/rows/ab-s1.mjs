// AB-S1 — DevTools 模拟器: API 面 + path/bytes 对照臂 (V-A1, V-A2, V-A5)
import { join } from "node:path";
import { existsSync } from "node:fs";
import { startMockWasm } from "../lib/wasm-server.mjs";
import { launchSpikeMp, setTargetConfig, grabProbeResult, deviceInfo, closeMp } from "../lib/automator.mjs";
import { assertProbeResultShape } from "../ref/probe-spec.mjs";

export async function run(ctx) {
  const { spikeDir, row } = ctx;
  const mpDir = join(spikeDir, "mp");
  if (!existsSync(join(mpDir, "wasm", "echo.wasm"))) {
    return { verdict: "NOT_RUN", reason: "mp/wasm/echo.wasm missing; run `node harness/run.mjs --build` first" };
  }
  if (!existsSync(join(spikeDir, "fixtures", "echo.wasm"))) {
    return { verdict: "NOT_RUN", reason: "fixtures/echo.wasm missing; run `node harness/run.mjs --build` first" };
  }
  const mock = await startMockWasm({ fixturesDir: join(spikeDir, "fixtures") });
  let miniProgram;
  try {
    try {
      miniProgram = await launchSpikeMp(mpDir);
    } catch (e) {
      return {
        verdict: "NOT_RUN",
        reason: `automator launch failed: ${(e && e.message) || e}`,
        detail: { hint: "devtools service port may be disabled or first-run dialog pending" },
      };
    }
    const device = await deviceInfo(miniProgram);
    await setTargetConfig(miniProgram, { base: mock.url, arms: row.arms });
    const result = await grabProbeResult(miniProgram, { timeoutMs: 120_000 });
    if (!result) {
      return { verdict: "RED", reason: "probe page produced no result within 120s", device };
    }
    if (result.fatal) {
      return { verdict: "RED", reason: `probe page fatal: ${result.fatal}`, device };
    }
    const shapeErr = assertProbeResultShape(result);
    if (shapeErr) {
      return { verdict: "RED", reason: `probe result shape invalid: ${shapeErr}`, device };
    }
    const s = result.apiSurface;
    const b = result.bytesRaw ?? {};
    const stats = result.stats ?? {};
    // V-A1: full seven-key surface contract (charter §2) — all must be functions
    const checks = {
      moduleCtor: s.wxWasmModule === "function",
      instanceCtor: s.wxWasmInstance === "function",
      memoryCtor: s.wxWasmMemory === "function",
      tableCtor: s.wxWasmTable === "function",
      moduleImportsFn: s.wxWasmModuleImports === "function",
      moduleExportsFn: s.wxWasmModuleExports === "function",
      moduleCustomSectionsFn: s.wxWasmModuleCustomSections === "function",
      pathOk: result.pathBaseline?.ok === true && result.pathBaseline?.value === 42,
      bytesOk: b.ok === true && b.value === 42,
      moduleFromView: b.moduleFromView === true,
      badModuleThrew: b.badModuleThrew === true,
      badLinkThrew: b.badLinkThrew === true,
      // V-A5 byte provenance: the probe must have pulled bytes from this mock
      fromMock: result.baseHost === `127.0.0.1:${mock.port}`,
    };
    const plants = [
      {
        id: "P-bytes-bad",
        fired: b.badModuleThrew === true && b.badLinkThrew === true,
        restored: b.ok === true && b.value === 42,
      },
    ];
    const budgetUsed = { objects: 2, ops: stats.httpOps ?? null, bytes: stats.httpBytes ?? null };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `sim checks failed: ${failed.join(",")}`,
        counts: { bytesOk: checks.bytesOk ? 1 : 0, pathOk: checks.pathOk ? 1 : 0 },
        plants,
        budgetUsed,
        device,
        detail: { apiSurface: s, cryptoProbe: result.cryptoProbe, altEntries: result.altEntries ?? null, pathBaseline: result.pathBaseline, bytesRaw: b, mock: { bind: mock.bind, port: mock.port } },
      };
    }
    return {
      verdict: "PASS",
      reason: "simulator: full WXWebAssembly bytes surface present; path and bytes instantiation both yield echo()=42; bytes provenance = this mock (package file not required for bytes arm)",
      counts: { bytesOk: 1, pathOk: 1 },
      plants,
      budgetUsed,
      device,
      detail: {
        apiSurface: s,
        cryptoProbe: result.cryptoProbe,
        // exploratory facts: is ANY byte-capable entry available? (informational,
        // does not change this row's verdict)
        altEntries: result.altEntries ?? null,
        timings: {
          pathTotalMs: result.pathBaseline?.totalMs ?? null,
          bytesFetchMs: b.fetchMs ?? null,
          bytesCompileMs: b.compileMs ?? null,
          bytesLinkMs: b.linkMs ?? null,
        },
        mock: { bind: mock.bind, port: mock.port },
      },
    };
  } finally {
    await closeMp(miniProgram);
    await mock.close();
  }
}
