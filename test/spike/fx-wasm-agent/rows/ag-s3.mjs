// AG-S3 — DevTools 模拟器：分包 instantiate 探针（不走 LLM，无 remoteOps）。
import { driveSim } from "../lib/sim.mjs";

export async function run({ spikeDir }) {
  const t0 = Date.now();
  const { fxTest, device } = await driveSim(spikeDir, "probe", { timeoutMs: 60_000 });
  if (!fxTest) return { verdict: "RED", reason: "fxTest 未出现（探针未回报）" };
  const need = ["asyncify_get_state", "asyncify_start_unwind", "asyncify_start_rewind"];
  const present = fxTest.asyncify || [];
  // 镜像 P-agent-exports：断言一个模块不存在的导出必假（fired），真实导出必真（restored）
  const plants = [{
    id: "P-agent-exports",
    fired: !present.includes("asyncify_teleport"),
    restored: need.every((k) => present.includes(k)),
  }];
  const checks = {
    probeDone: fxTest.phase === "probe-done",
    startExport: fxTest.start === true,
    asyncifyExports: need.every((k) => present.includes(k)),
    memoryGrew: fxTest.memPagesAfter === (fxTest.memPagesBefore ?? -1) + 1,
    subpackagePath: String(fxTest.wasmPath || "").startsWith("subpkg/"),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    verdict: failed.length ? "RED" : "PASS",
    reason: failed.length ? `failed: ${failed.join(",")} (${fxTest.error || fxTest.phase})` : "分包 3.9MB wasm 实例化 + asyncify 导出面就位",
    device,
    counts: { wasmBytes: 4098991, instantiateMs: fxTest.instantiateMs ?? null },
    timing: { diagnostic: { instantiateMs: fxTest.instantiateMs ?? null, totalMs: Date.now() - t0 } },
    remoteOps: 0,
    plants,
    detail: { phase: fxTest.phase, asyncify: present, memPages: [fxTest.memPagesBefore, fxTest.memPagesAfter], error: fxTest.error ?? null },
  };
}
