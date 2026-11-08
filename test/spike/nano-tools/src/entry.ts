// spike / nano-tools — disposable evidence surface, NOT production code.
// Mirrors workers/bash-core worker-runtime registerAllHandlers composition
// (16 handler factories, no PX/test fixtures, no service-binding target),
// exposing createSpikeRuntime(workspace) for H1/S1/R2 drivers.

import { InMemoryCapabilityRegistry } from "@haimang/bash-core-worker/registry";
import { LocalTsTarget } from "@haimang/bash-core-worker/targets/local-ts";
import { CapabilityExecutor } from "@haimang/bash-core-worker/executor";
import { CapabilityPolicyGate } from "@haimang/bash-core-worker/policy";
import { registerMinimalCommands } from "@haimang/bash-core-worker/fake-bash/commands";
import { FakeBashBridge } from "@haimang/bash-core-worker/fake-bash/bridge";
import { planBashLine, planFromToolCall } from "@haimang/bash-core-worker/planner";
import { BASH_TOOL_CONTRACT_SOURCE } from "@haimang/bash-core-worker/tool-contract/source";
import { BASH_RUNTIME_BINDINGS } from "@haimang/bash-core-worker/tool-contract/runtime-bindings";

import { createFilesystemHandlers } from "@haimang/bash-core-worker/capabilities/filesystem";
import { createSearchHandlers } from "@haimang/bash-core-worker/capabilities/search";
import { createFindHandlers } from "@haimang/bash-core-worker/capabilities/find";
import { createTextProcessingHandlers } from "@haimang/bash-core-worker/capabilities/text-processing";
import { createUtilHandlers } from "@haimang/bash-core-worker/capabilities/util";
import { createTeeHandlers } from "@haimang/bash-core-worker/capabilities/tee";
import { createNetworkHandlers } from "@haimang/bash-core-worker/capabilities/network";
import { createExecHandlers } from "@haimang/bash-core-worker/capabilities/exec";
import { createVcsHandlers } from "@haimang/bash-core-worker/capabilities/vcs";
import { createTextOutputHandlers } from "@haimang/bash-core-worker/capabilities/text-output";
import { createTimeHandlers } from "@haimang/bash-core-worker/capabilities/time";
import { createWhichHandlers } from "@haimang/bash-core-worker/capabilities/which";
import { createStatHandlers } from "@haimang/bash-core-worker/capabilities/stat";
import { createTreeHandlers } from "@haimang/bash-core-worker/capabilities/tree";
import { createToolIntentHandlers } from "@haimang/bash-core-worker/tool-contract/intents";
import { createPipelineHandlers } from "@haimang/bash-core-worker/capabilities/pipeline";
import { setContentScanKernelFactoryForTest } from "@haimang/bash-core-worker/content-scan-host";
import { createTsKernel } from "./kernel-ts";
import { createWasmKernel } from "./kernel-wasm";
import { setSpanWasmSources } from "@haimang/bash-core-worker/targets/span-runtime";

// rg's scan surface is a Rust→wasm kernel. workerd/Node instantiate the real
// artifact; the mini-program appservice cannot (WXWebAssembly is worker-only),
// so the default here is the TS simulation of the same ABI. H1 switches to
// the real wasm via useWasmKernel(bytes) and both lanes must agree row-for-row.
setContentScanKernelFactoryForTest(async () => createTsKernel());

export function useWasmKernel(bytes: ArrayBuffer | Uint8Array) {
  setContentScanKernelFactoryForTest(async () => createWasmKernel(bytes));
}

// span: the locator is pure TS; only the parser needs wasm. H1 injects the
// three pinned payloads; the mp lane cannot (no WebAssembly in appservice).
export function useSpanWasm(runtime: Uint8Array, javascript: Uint8Array, python: Uint8Array) {
  setSpanWasmSources({ runtime, javascript, python });
}

export async function debugSpanInit(runtime: Uint8Array, js: Uint8Array): Promise<string> {
  try {
    const mod: any = await import("web-tree-sitter");
    const Parser = mod.Parser ?? mod.default?.Parser;
    const Language = mod.Language ?? mod.default?.Language;
    await Parser.init({ wasmBinary: runtime } as never);
    const lang = await Language.load(js);
    const p = new Parser();
    p.setLanguage(lang);
    const tree = p.parse("function foo(){return 1}");
    return "ok:" + tree.rootNode.type;
  } catch (e) {
    return "err:" + String((e && (e as any).stack) || e).slice(0, 300);
  }
}

export function useTsKernel() {
  setContentScanKernelFactoryForTest(async () => createTsKernel());
}

export const SPIKE_IDS = BASH_TOOL_CONTRACT_SOURCE.map((s) => s.canonical_id);
export const SPIKE_ROUTES = Object.fromEntries(
  BASH_RUNTIME_BINDINGS.map((b) => [b.canonical_id, b.route]),
);

// in-bundle environment probe — distinguishes "substrate missing inside the
// bundle scope" from "page-context differs" (mp page eval runs in the same
// global but a different module scope).
export function spikeProbeEnv() {
  const out = { urlType: typeof URL, gUrlType: typeof globalThis.URL, cryptoType: typeof crypto, subtle: false, randomUUID: false };
  try {
    const u = new URL("https://dsh-mini.saobao.com/robots.txt");
    out.protocol = u.protocol;
    out.hostname = u.hostname;
    out.username = JSON.stringify(u.username);
  } catch (e) {
    out.urlErr = String(e && (e.stack || e.message) || e).slice(0, 200);
  }
  try {
    const d = Object.getOwnPropertyDescriptor(globalThis, "URL");
    out.urlDescriptor = d ? JSON.stringify({ w: d.writable, c: d.configurable, e: d.enumerable, v: typeof d.value }) : "absent";
  } catch (e) { out.urlDescriptor = "err:" + String(e).slice(0, 80); }
  try {
    out.subtle = !!(crypto && crypto.subtle);
    out.randomUUID = typeof crypto?.randomUUID === "function";
  } catch { }
  return out;
}

export function createSpikeRuntime(workspace, opts = {}) {
  const registry = new InMemoryCapabilityRegistry();
  registerMinimalCommands(registry);

  const target = new LocalTsTarget();
  const maps = [
    createFilesystemHandlers({ workspacePath: opts.workspacePath || "/data/spike" }),
    createSearchHandlers({}),
    createFindHandlers({}),
    createTextProcessingHandlers(),
    createUtilHandlers(),
    createTeeHandlers(),
    createNetworkHandlers({
      fetchImpl: opts.fetchImpl ||
        (typeof fetch === "function" ? fetch.bind(globalThis) : undefined),
    }),
    createExecHandlers(),
    createVcsHandlers(),
    createTextOutputHandlers(),
    createTimeHandlers(),
    createWhichHandlers(),
    createStatHandlers({}),
    createTreeHandlers({}),
    createToolIntentHandlers(),
    createPipelineHandlers({ registry }),
  ];
  for (const m of maps) for (const [name, h] of m) target.registerHandler(name, h);

  const executor = new CapabilityExecutor(
    new Map([["local-ts", target]]),
    new CapabilityPolicyGate(registry),
    {
      // spike records ask-gated commands separately; auto-allow via hook
      // outcome so gated commands still execute (evidence records gate).
      policyContextProvider: () => ({ hookOutcome: "allow" }),
      timeoutMs: opts.timeoutMs || 30000,
    },
  );

  const baseCtx = () => ({
    workspace,
    teamUuid: "spike-team",
    sessionUuid: "spike-session",
    workspaceUuid: "spike",
    networkPolicyMode: "restricted",
    pipelineExecutor: executor,
  });

  const bridge = new FakeBashBridge(registry, planBashLine, executor, {
    interpreterCoreEnabled: true,
    globSeamEnabled: true,
    workspacePath: opts.workspacePath || "/data/spike",
    ctx: baseCtx(),
  });

  return {
    ids: SPIKE_IDS,
    routes: SPIKE_ROUTES,
    registryList: () => registry.list().map((d) => d.name),
    dispatchTool: async (name, args) => {
      const plan = planFromToolCall(name, args ?? {}, registry);
      if (!plan) return { __spikeError: "no-plan", name };
      return executor.execute(plan, baseCtx());
    },
    dispatchBash: async (line) => bridge.execute(line),
  };
}
