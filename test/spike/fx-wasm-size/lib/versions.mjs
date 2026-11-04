import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function versions() {
  const v = { node: process.versions.node, binaryen: null, libfx: "0.0.16" };
  try {
    v.binaryen = require("binaryen/package.json").version;
  } catch {}
  return v;
}
