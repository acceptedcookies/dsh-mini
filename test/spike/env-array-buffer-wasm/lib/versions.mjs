// Version pins recorded into receipts.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function versions() {
  const v = { node: process.versions.node, devtoolsCliPresent: null, wabt: null };
  v.devtoolsCliPresent = existsSync("/Applications/wechatwebdevtools.app/Contents/MacOS/cli");
  try {
    v.wabt = require("wabt/package.json").version;
  } catch {}
  return v;
}
