// Environment gates before a row runs (charter §3.2).
import { existsSync } from "node:fs";

const DEVTOOLS_CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";

export function preflight(envClass) {
  switch (envClass) {
    case "host-node": {
      const major = Number(process.versions.node.split(".")[0]);
      if (!(major >= 18)) {
        return { ok: false, reason: `node >= 18 required, got ${process.versions.node}` };
      }
      return { ok: true };
    }
    case "devtools-sim": {
      if (!existsSync(DEVTOOLS_CLI)) {
        return { ok: false, reason: `wechat devtools cli missing at ${DEVTOOLS_CLI}` };
      }
      return { ok: true };
    }
    case "ios":
    case "android": {
      const model = process.env.SPIKE_DEVICE_MODEL;
      if (!model) {
        return {
          ok: false,
          reason: `real device not provisioned (owner gate D-*); set SPIKE_DEVICE_MODEL + SPIKE_DEVICE_* to run`,
        };
      }
      return {
        ok: true,
        device: {
          model,
          osVersion: process.env.SPIKE_DEVICE_OS ?? null,
          wechatVersion: process.env.SPIKE_DEVICE_WECHAT ?? null,
          baseLibVersion: process.env.SPIKE_DEVICE_BASELIB ?? null,
          sdkVersion: process.env.SPIKE_DEVICE_SDK ?? null,
        },
      };
    }
    default:
      return { ok: false, reason: `unknown envClass ${envClass}` };
  }
}
