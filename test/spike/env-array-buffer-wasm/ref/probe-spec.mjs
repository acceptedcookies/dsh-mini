// Independent probe checklist — implemented separately from mp/probe/probe.js.
// Rows compare the probe page's reported arms against this spec's expectation
// shape; a mismatch in *structure* (not value) is a probe defect.

export const API_SURFACE_KEYS = [
  "wxWasm",
  "wxWasmModule",
  "wxWasmInstance",
  "wxWasmMemory",
  "wxWasmTable",
  "wxWasmGlobal",
  "wxWasmInstantiate",
  "wxWasmModuleImports",
  "wxWasmModuleExports",
  "wxWasmModuleCustomSections",
  "wxWasmCompile",
  "wxWasmValidate",
  "stdWasm",
  "stdWasmModule",
  "cryptoSubtle",
  "cryptoGetRandomValues",
  "wxGetRandomValues",
];

export const ARM_KEYS = [
  "cryptoProbe",
  "pathBaseline",
  "bytesRaw",
  "altEntries",
  "encPipeline",
  "fxReal",
];

export function assertApiSurfaceShape(surface) {
  if (typeof surface !== "object" || surface === null) return "apiSurface not an object";
  for (const key of API_SURFACE_KEYS) {
    if (typeof surface[key] !== "string") return `apiSurface.${key} missing or not a string`;
  }
  return null;
}

// An arm either ran (ok boolean present) or was not selected (skipped string).
// Anything else is a malformed probe result.
export function assertProbeResultShape(result) {
  const err = assertApiSurfaceShape(result?.apiSurface);
  if (err) return err;
  for (const key of ARM_KEYS) {
    const arm = result?.[key];
    if (typeof arm !== "object" || arm === null) return `${key} missing`;
    const ran = typeof arm.ok === "boolean";
    const skipped = typeof arm.skipped === "string";
    if (!ran && !skipped) return `${key}: neither ok nor skipped`;
  }
  return null;
}
