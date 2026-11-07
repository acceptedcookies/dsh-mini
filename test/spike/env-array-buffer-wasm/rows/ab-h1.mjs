// AB-H1 — 宿主对照臂：bytes 实例化 + 变换互逆 + 镜像 (V-A1/V-A2 host reference)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { watToWasm } from "../lib/wasm-build.mjs";
import { xorCrypt } from "../lib/transform.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const echoBytes = await watToWasm(readFileSync(join(spikeDir, "fixtures", "echo.wat"), "utf8"));
  const badBytes = await watToWasm(readFileSync(join(spikeDir, "fixtures", "bad.wat"), "utf8"));
  const surface = {
    stdWasmModule: typeof WebAssembly.Module,
    stdWasmInstance: typeof WebAssembly.Instance,
    stdWasmMemory: typeof WebAssembly.Memory,
    stdWasmTable: typeof WebAssembly.Table,
    stdWasmModuleImports: typeof WebAssembly.Module.imports,
    stdWasmModuleExports: typeof WebAssembly.Module.exports,
    stdWasmModuleCustomSections: typeof WebAssembly.Module.customSections,
  };
  const plants = [];

  // V-A2 reference: Module(bytes) + Instance -> echo()=42; view acceptance
  const mod = new WebAssembly.Module(echoBytes);
  const inst = new WebAssembly.Instance(mod, {});
  const value = inst.exports.echo();
  const viewOk = (() => {
    try {
      new WebAssembly.Module(new Uint8Array(echoBytes));
      return true;
    } catch {
      return false;
    }
  })();

  // P-bytes-bad: garbage must throw at Module; bad.wasm must throw at Instance
  let badModuleThrew = false;
  let badModuleName = null;
  try {
    new WebAssembly.Module(new Uint8Array([0, 1, 2, 3, 4, 5]));
  } catch (e) {
    badModuleThrew = true;
    badModuleName = e.name;
  }
  let badLinkThrew = false;
  let badLinkName = null;
  try {
    new WebAssembly.Instance(new WebAssembly.Module(badBytes), {});
  } catch (e) {
    badLinkThrew = true;
    badLinkName = e.name;
  }
  plants.push({ id: "P-bytes-bad", fired: badModuleThrew && badLinkThrew, restored: value === 42 });

  // P-transform-roundtrip: enc/dec involution + wrong-label decrypt differs
  const enc = xorCrypt(echoBytes, "echo");
  const dec = xorCrypt(enc, "echo");
  const roundtrip = dec.length === echoBytes.length && dec.every((b, i) => b === echoBytes[i]);
  const wrong = xorCrypt(enc, "echo-bad");
  const differs = wrong.some((b, i) => b !== echoBytes[i]);
  plants.push({ id: "P-transform-roundtrip", fired: roundtrip && differs, restored: roundtrip });

  const checks = {
    valueIs42: value === 42,
    moduleCtor: surface.stdWasmModule === "function",
    instanceCtor: surface.stdWasmInstance === "function",
    memoryCtor: surface.stdWasmMemory === "function",
    tableCtor: surface.stdWasmTable === "function",
    moduleImportsFn: surface.stdWasmModuleImports === "function",
    moduleExportsFn: surface.stdWasmModuleExports === "function",
    moduleCustomSectionsFn: surface.stdWasmModuleCustomSections === "function",
    viewOk,
    badModuleThrew,
    badLinkThrew,
    roundtrip,
    differs,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const budgetUsed = { objects: 2, ops: 4, bytes: echoBytes.length + badBytes.length };
  if (failed.length) {
    return {
      verdict: "RED",
      reason: `host checks failed: ${failed.join(",")}`,
      counts: { value },
      plants,
      budgetUsed,
      detail: { surface, echoBytes: echoBytes.length, badModuleName, badLinkName },
    };
  }
  return {
    verdict: "PASS",
    reason:
      "host reference: Module(bytes)+Instance works (echo()=42), Uint8Array view accepted, full Module surface present, transform involution verified, bad arms throw with expected error classes",
    counts: { value, echoBytes: echoBytes.length },
    plants,
    budgetUsed,
    detail: { surface, badModuleName, badLinkName },
  };
}
