export function preflight(envClass) {
  if (envClass !== "host-node") {
    return { ok: false, reason: `fx-wasm-size defines only host-node rows, got ${envClass}` };
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (!(major >= 18)) {
    return { ok: false, reason: `node >= 18 required, got ${process.versions.node}` };
  }
  return { ok: true };
}
