// P-size-fat plant generator: append a 1 MiB custom section to a wasm binary.
import { readFileSync, writeFileSync } from "node:fs";

export function fatten(inPath, outPath, extraBytes = 1024 * 1024) {
  const src = readFileSync(inPath);
  const name = "spike-fat";
  const nameLen = Buffer.from([name.length]);
  const payload = Buffer.alloc(extraBytes, 0xab);
  const body = Buffer.concat([nameLen, Buffer.from(name, "utf8"), payload]);
  const header = Buffer.from([0x00]); // custom section id
  const sizeLEB = encodeU32(body.length);
  writeFileSync(outPath, Buffer.concat([src, header, sizeLEB, body]));
  return outPath;
}

function encodeU32(n) {
  const bytes = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    bytes.push(b);
  } while (n);
  return Buffer.from(bytes);
}
