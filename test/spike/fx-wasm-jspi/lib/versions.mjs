// Version pins recorded into receipts.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function versions() {
  const v = { node: process.versions.node, devtoolsCli: null, wabt: null, binaryen: null };
  v.devtoolsCli = existsSync("/Applications/wechatwebdevtools.app/Contents/MacOS/cli");
  try {
    v.wabt = require("wabt/package.json").version;
  } catch {}
  try {
    v.binaryen = require("binaryen/package.json").version;
  } catch {}
  return v;
}
