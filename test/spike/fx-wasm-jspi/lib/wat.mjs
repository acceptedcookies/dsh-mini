// wat -> wasm via wabt; asyncify transform via binaryen.
import binaryen from "binaryen";
import wabtFn from "wabt";

let wabtPromise = null;
function wabt() {
  wabtPromise ??= wabtFn();
  return wabtPromise;
}

export async function watToWasm(source, { asyncify = false } = {}) {
  const w = await wabt();
  const parsed = w.parseWat("spike.wat", source);
  const { buffer } = parsed.toBinary({});
  if (!asyncify) return new Uint8Array(buffer);
  const mod = binaryen.readBinary(new Uint8Array(buffer));
  mod.runPasses(["asyncify"]);
  return mod.emitBinary();
}
