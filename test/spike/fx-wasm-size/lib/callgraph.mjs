// Call-graph import-family attribution for fx-core.wasm.
// Per-function body sizes are self-parsed from the code section; direct-call
// edges come from `wasm-objdump -d` (wabt). call_indirect targets are not
// statically resolvable — the receipt reports their count as the
// conservativeness floor of the analysis.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WASM_OBJDUMP = join(dirname(require.resolve("wabt/package.json")), "bin", "wasm-objdump");

function readU32(buf, pos) {
  let result = 0;
  let shift = 0;
  while (true) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

export function functionSizes(buf) {
  // Walk the code section (id 10): vec of size-prefixed function bodies.
  let pos = 8;
  while (pos < buf.length) {
    const id = buf[pos++];
    const [size, bodyStart] = readU32(buf, pos);
    const end = bodyStart + size;
    if (id === 10) {
      const [count, first] = readU32(buf, bodyStart);
      const sizes = new Array(count);
      let p = first;
      for (let i = 0; i < count; i++) {
        const [bodySize, start] = readU32(buf, p);
        sizes[i] = bodySize + (start - p); // body + its size prefix
        p = start + bodySize;
      }
      return sizes; // index 0 = first defined function (after imports)
    }
    pos = end;
  }
  throw new Error("no code section");
}

export function directCallEdges(path) {
  // Parse `wasm-objdump -d`: "func[i]" headers and "call N" targets.
  const out = execFileSync("node", [WASM_OBJDUMP, "-d", path], {
    maxBuffer: 512 * 1024 * 1024,
  }).toString("utf8");
  const edges = new Map(); // defined funcidx -> Set(callee funcidx)
  let current = -1;
  let indirectCalls = 0;
  for (const line of out.split("\n")) {
    const head = /\bfunc\[(\d+)\]/.exec(line);
    if (head) {
      current = Number(head[1]);
      if (!edges.has(current)) edges.set(current, new Set());
      continue;
    }
    if (current < 0) continue;
    const call = /\bcall (\d+)\b/.exec(line);
    if (call) {
      edges.get(current).add(Number(call[1]));
    } else if (/\bcall_indirect\b/.test(line)) {
      indirectCalls += 1;
    }
  }
  return { edges, indirectCalls };
}

// Families keyed on the 55-import surface of fx-core.wasm. An import belongs
// to a family by its module/name prefix; everything else is "wasi".
const FAMILIES = [
  ["http", (m, n) => n.startsWith("fx_http")],
  ["session", (m, n) => n.startsWith("fx_session")],
  ["oauth", (m, n) => n.startsWith("fx_oauth")],
  ["journal", (m, n) => n.startsWith("fx_journal")],
  ["steering", (m, n) => n.startsWith("fx_steering")],
  ["host_tool", (m, n) => n.startsWith("fx_host_tool")],
  ["attachment", (m, n) => n.startsWith("fx_attachment")],
  ["wasi_fs", (m, n) => n.startsWith("fd_") || n.startsWith("path_")],
  ["wasi_other", (m, n) => m === "wasi_snapshot_preview1"],
];

export function importFamilies(buf) {
  const mod = new WebAssembly.Module(buf);
  const imports = WebAssembly.Module.imports(mod).filter((i) => i.kind === "function");
  const familyOf = new Array(imports.length);
  imports.forEach((imp, i) => {
    const hit = FAMILIES.find(([, pred]) => pred(imp.module, imp.name));
    familyOf[i] = hit ? hit[0] : "wasi_other";
  });
  return { imports, familyOf };
}

// For every defined function, the set of families it can transitively reach
// through direct calls. Returns per-family inclusive/exclusive byte counts.
export function attribute(buf, path) {
  const { imports, familyOf } = importFamilies(buf);
  const importCount = imports.length;
  const sizes = functionSizes(buf);
  const { edges, indirectCalls } = directCallEdges(path);

  // Reverse edges for reachability: from each import idx, walk backwards to
  // every function that can reach it.
  const reverse = new Map();
  for (const [from, tos] of edges) for (const to of tos) {
    if (!reverse.has(to)) reverse.set(to, new Set());
    reverse.get(to).add(from);
  }

  const familySets = new Map(); // family -> Set(defFuncIdx)
  for (let i = 0; i < importCount; i++) {
    const family = familyOf[i];
    if (!familySets.has(family)) familySets.set(family, new Set());
    const reach = familySets.get(family);
    const stack = [i];
    while (stack.length) {
      const node = stack.pop();
      for (const caller of reverse.get(node) ?? []) {
        if (!reach.has(caller)) {
          reach.add(caller);
          stack.push(caller);
        }
      }
    }
  }

  // definedFuncIdx in code section = funcidx - importCount
  const totalCode = sizes.reduce((a, b) => a + b, 0);
  const perFnFamilies = sizes.map(() => new Set());
  for (const [family, fns] of familySets) {
    for (const fnIdx of fns) {
      const def = fnIdx - importCount;
      if (def >= 0 && def < sizes.length) perFnFamilies[def].add(family);
    }
  }

  const inclusive = {}; // functions reaching the family (may overlap)
  const exclusive = {}; // functions reaching ONLY this family
  let unattributed = 0;
  let multiFamily = 0;
  for (let i = 0; i < sizes.length; i++) {
    const fams = perFnFamilies[i];
    if (fams.size === 0) unattributed += sizes[i];
    if (fams.size > 1) multiFamily += sizes[i];
    for (const f of fams) inclusive[f] = (inclusive[f] ?? 0) + sizes[i];
    if (fams.size === 1) {
      const [f] = fams;
      exclusive[f] = (exclusive[f] ?? 0) + sizes[i];
    }
  }
  return {
    importCount,
    definedFunctions: sizes.length,
    totalCode,
    indirectCalls,
    inclusive,
    exclusive,
    unattributed,
    multiFamily,
    familyMembers: Object.fromEntries(
      [...familySets].map(([f, s]) => [f, s.size]),
    ),
  };
}
