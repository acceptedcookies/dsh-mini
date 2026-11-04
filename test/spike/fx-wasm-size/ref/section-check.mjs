// Independent size cross-check — counts functions/exports/imports so the
// section census can't silently misattribute mass. Uses the standard
// WebAssembly.Module API plus direct section-body parsing for counts the
// JS API doesn't expose.
import { readFileSync } from "node:fs";

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

// count of entries in a vector-shaped section body (function/import sections
// start with a vec length; we only need the length field)
function vecCount(buf, bodyStart) {
  const [n] = readU32(buf, bodyStart);
  return n;
}

export function binaryenCrossCheck(path) {
  const buf = readFileSync(path);
  const mod = new WebAssembly.Module(buf);
  const exports = WebAssembly.Module.exports(mod);
  const imports = WebAssembly.Module.imports(mod);
  let pos = 8;
  let numFunctions = null;
  let numImportsDeclared = null;
  while (pos < buf.length) {
    const id = buf[pos++];
    const [size, bodyStart] = readU32(buf, pos);
    if (id === 3) numFunctions = vecCount(buf, bodyStart);
    if (id === 2) numImportsDeclared = vecCount(buf, bodyStart);
    pos = bodyStart + size;
  }
  return {
    numFunctions,
    numImportsDeclared,
    numExports: exports.length,
    numImportsApi: imports.length,
  };
}
