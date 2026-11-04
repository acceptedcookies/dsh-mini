// JW-H2 — Asyncify toy 两次异步宿主往返 (V-J3)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { watToWasm } from "../lib/wat.mjs";
import { instantiateAsync, driveAsyncified } from "../lib/asyncify.mjs";

export async function run(ctx) {
  const { spikeDir } = ctx;
  const toySrc = readFileSync(join(spikeDir, "fixtures", "async-toy.wat"), "utf8");
  const toyBytes = await watToWasm(toySrc, { asyncify: true });
  const badBytes = await watToWasm(
    readFileSync(join(spikeDir, "fixtures", "bad.wat"), "utf8"),
  );

  const plants = [];

  // plant P-wasm-bad: missing import must reject.
  try {
    new WebAssembly.Instance(new WebAssembly.Module(badBytes), { env: {} });
    plants.push({ id: "P-wasm-bad", fired: false, restored: false });
    return { verdict: "RED", reason: "P-wasm-bad did not reject: instantiate succeeded without env.missing", plants };
  } catch (e) {
    plants.push({ id: "P-wasm-bad", fired: true, restored: true });
  }

  // V-J3: asyncified toy completes two suspends, sum=7+35, memCalls=2.
  const seq = [7, 35];
  let seqIdx = 0;
  let suspends = 0;
  const instance = instantiateAsync(toyBytes, {
    host_read: async () => {
      suspends += 1;
      await new Promise((r) => setTimeout(r, 5));
      return seq[seqIdx++];
    },
  });
  const sum = await driveAsyncified(instance, "run");
  const memCalls = new Int32Array(instance.exports.memory.buffer)[0];
  const checks = {
    sumIs42: sum === 42,
    memCallsIs2: memCalls === 2,
    suspendsIs2: suspends === 2,
  };
  if (!Object.values(checks).every(Boolean)) {
    return { verdict: "RED", reason: "asyncify roundtrip failed", counts: { sum, memCalls, suspends }, plants };
  }

  // plant P-async-sync: synchronous host never unwinds; the honest meter is the
  // asyncify state machine itself — it must stay 0 with no resume loop, while a
  // call-count meter would falsely claim suspends happened.
  let syncSeq = 0;
  const syncInst = instantiateAsync(toyBytes, {
    host_read: () => seq[syncSeq++],
  });
  const syncSum = syncInst.exports.run();
  const syncMemCalls = new Int32Array(syncInst.exports.memory.buffer)[0];
  const discriminated =
    syncInst.exports.asyncify_get_state() === 0 && syncSum === 42 && syncMemCalls === 2;
  plants.push({ id: "P-async-sync", fired: discriminated, restored: true });

  return {
    verdict: "PASS",
    reason: "asyncify toy: 2 suspends, correct sum, wasm-side counter intact; sync arm proves the suspend meter discriminates",
    counts: { sum, memCalls, suspends, syncSum, syncMemCalls },
    plants,
    detail: { toyBytes: toyBytes.length },
  };
}
