// JW-H1 — 宿主 JSPI API 面探测 (V-J1)
export async function run(ctx) {
  const surface = {
    stdWasm: typeof WebAssembly,
    stdWasmSuspending: typeof WebAssembly?.Suspending,
    stdWasmPromising: typeof WebAssembly?.promising,
    stdWasmFunctionPromising: typeof WebAssembly?.Function?.promising,
    wxWasm: typeof WXWebAssembly,
  };
  // plant P-jspi-null: a probe that asserts JSPI present must go RED on this host.
  const plants = [
    {
      id: "P-jspi-null",
      fired: !(surface.stdWasmSuspending === "function"),
      restored: true,
    },
  ];
  const jspiPresent =
    surface.stdWasmSuspending === "function" && surface.stdWasmPromising === "function";
  return {
    verdict: "PASS",
    reason: jspiPresent
      ? "host exposes JSPI bindings"
      : "host lacks JSPI bindings (V8 flag exists, JS API absent) — Asyncify arm is load-bearing",
    counts: { jspiPresent: jspiPresent ? 1 : 0 },
    plants,
    detail: { apiSurface: surface, envNote: "WXWebAssembly absent on host by definition" },
  };
}
