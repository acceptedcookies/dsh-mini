// Version pins recorded into receipts.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const DEVTOOLS_CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";

function toolVersion(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
  } catch {
    return null;
  }
}

export function versions() {
  return {
    node: process.versions.node,
    devtoolsCli: existsSync(DEVTOOLS_CLI),
    rustc: toolVersion("rustc --version"),
    cargo: toolVersion("cargo --version"),
    wasmTarget: (() => {
      try {
        return execSync("rustup target list --installed", { encoding: "utf8" })
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(",");
      } catch {
        return null;
      }
    })(),
  };
}
