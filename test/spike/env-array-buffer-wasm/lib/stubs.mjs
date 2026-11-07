// Build a best-effort stub importObject from Module.imports descriptors (host arm).
// fx-core-async.wasm: 55 function imports, 0 memory/table/global — stubs are never
// invoked (we link but do not run _start), so JS->wasm return-type mismatches
// cannot fire at instantiation time. `calls` counts any accidental invocation —
// the P-stub-quiet plant requires it to stay 0 after linking.
export function stubImports(imports) {
  const obj = {};
  const kinds = {};
  let calls = 0;
  for (const d of imports) {
    kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    const mod = (obj[d.module] ??= {});
    if (d.kind === "function") {
      mod[d.name] = () => {
        calls += 1;
        return 0;
      };
    } else if (d.kind === "memory") {
      mod[d.name] = new WebAssembly.Memory({ initial: 1 });
    } else if (d.kind === "table") {
      mod[d.name] = new WebAssembly.Table({ element: "anyfunc", initial: 1 });
    } else {
      mod[d.name] = 0; // global best-effort: Number accepted for immutable numeric globals
    }
  }
  return { obj, kinds, calls: () => calls };
}
