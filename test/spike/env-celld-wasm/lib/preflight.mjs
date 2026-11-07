// Environment gates before a row runs (charter §3.2).
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEVTOOLS_CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function cargoOk() {
  try {
    execSync("cargo --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** wasm 产物与 golden 是否就绪（harness --build 产出）。 */
export function buildArtifactsReady() {
  return (
    existsSync(join(SPIKE_DIR, "mp", "wasm", "celld-probe.wasm")) &&
    existsSync(join(SPIKE_DIR, "fixtures", "golden-transcript.txt"))
  );
}

export function preflight(envClass) {
  switch (envClass) {
    case "host-node": {
      const major = Number(process.versions.node.split(".")[0]);
      if (!(major >= 18)) {
        return { ok: false, reason: `node >= 18 required, got ${process.versions.node}` };
      }
      if (!cargoOk()) {
        return { ok: false, reason: "cargo/rustc not on PATH (rustup install required)" };
      }
      return { ok: true };
    }
    case "devtools-sim": {
      if (!existsSync(DEVTOOLS_CLI)) {
        return { ok: false, reason: `wechat devtools cli missing at ${DEVTOOLS_CLI}` };
      }
      if (!buildArtifactsReady()) {
        return { ok: false, reason: "build artifacts missing — run `node harness/run.mjs --build` first" };
      }
      return { ok: true };
    }
    case "ios":
    case "android": {
      // 真机在场与否由 driveDevice 自证（remote-debug 扫码窗口 + brand 判定），
      // preflight 只查通道前提：devtools cli + 构建产物。
      if (!existsSync(DEVTOOLS_CLI)) {
        return { ok: false, reason: `wechat devtools cli missing at ${DEVTOOLS_CLI}` };
      }
      if (!buildArtifactsReady()) {
        return { ok: false, reason: "build artifacts missing — run `node harness/run.mjs --build` first" };
      }
      return { ok: true };
    }
    default:
      return { ok: false, reason: `unknown envClass ${envClass}` };
  }
}
