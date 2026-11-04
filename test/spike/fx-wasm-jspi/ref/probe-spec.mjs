// Independent probe checklist — implemented separately from mp/probe/probe.js.
// Rows compare the probe page's reported apiSurface against this spec's
// expectation shape; a mismatch in *structure* (not value) is a probe defect.

export const API_SURFACE_KEYS = [
  "wxWasm",
  "wxWasmSuspending",
  "wxWasmPromising",
  "stdWasm",
  "stdWasmSuspending",
  "stdWasmPromising",
];

export function assertApiSurfaceShape(surface) {
  if (typeof surface !== "object" || surface === null) return "apiSurface not an object";
  for (const key of API_SURFACE_KEYS) {
    if (typeof surface[key] !== "string") return `apiSurface.${key} missing or not a string`;
  }
  return null;
}

export function assertProbeResultShape(result) {
  const err = assertApiSurfaceShape(result?.apiSurface);
  if (err) return err;
  for (const key of ["echo", "bad", "asyncToy"]) {
    if (typeof result[key] !== "object" || result[key] === null) return `${key} missing`;
  }
  if (typeof result.echo.ok !== "boolean") return "echo.ok not boolean";
  if (typeof result.bad.threw !== "boolean") return "bad.threw not boolean";
  if (typeof result.asyncToy.ok !== "boolean") return "asyncToy.ok not boolean";
  return null;
}
