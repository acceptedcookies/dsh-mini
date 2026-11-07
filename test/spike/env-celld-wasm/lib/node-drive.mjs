// Node 标准 WebAssembly 驱动：加载 celld-probe.wasm、跑 scenario、取回转录。
// EC-H2（host 对照臂）与可选本地复跑共用；与 mp/probe/probe.js 的 WXWebAssembly
// 驱动刻意分开实现——两臂一致性本身就是证据（charter §3.3）。
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function wasmPath(spikeDir) {
  return join(spikeDir, "mp", "wasm", "celld-probe.wasm");
}

export function goldenPath(spikeDir) {
  return join(spikeDir, "fixtures", "golden-transcript.txt");
}

/** 实例化并跑完整 scenario，返回 { transcript, stats }。 */
export async function driveNode(spikeDir) {
  const bytes = readFileSync(wasmPath(spikeDir));
  const t0 = Date.now();
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, {});
  const compileMs = Date.now() - t0;
  const ex = instance.exports;

  const stats = {
    wasmBytes: bytes.length,
    importCount: WebAssembly.Module.imports(module).length,
    exportNames: WebAssembly.Module.exports(module).map((e) => e.name),
    compileInstantiateMs: compileMs,
    memoryBytesAfter: null,
  };

  const t1 = Date.now();
  const p = ex.probe_create();
  ex.probe_run(p);
  const len = ex.probe_output_len(p);
  const ptr = ex.probe_output_ptr(p);
  const transcript = Buffer.from(ex.memory.buffer.slice(ptr, ptr + len)).toString("utf8");
  stats.runMs = Date.now() - t1;
  stats.transcriptBytes = len;
  stats.memoryBytesAfter = ex.memory.buffer.byteLength;
  ex.probe_destroy(p);
  return { transcript, stats };
}

/** 首个差异偏移；一致返回 -1。 */
export function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
