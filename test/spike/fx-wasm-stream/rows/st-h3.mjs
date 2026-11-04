// ST-H3 — 镜像行: P-sse-single + P-sse-split
import { startMockSse } from "../lib/sse-server.mjs";
import { createSseParser, parseDeltas } from "../lib/sse-parser.mjs";
import { expectedDeltas } from "../fixtures/corpus.mjs";

async function readAll(url) {
  const res = await fetch(url);
  const reader = res.body.getReader();
  const parser = createSseParser();
  let reads = 0;
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    reads += 1;
    for (const e of parser.feed(value)) events.push(e);
  }
  return { reads, events };
}

export async function run(ctx) {
  const mock = await startMockSse({ delayMs: 40 });
  try {
    const plants = [];
    // P-sse-single: a chunks>=2 gate must RED on single-flush delivery.
    const single = await readAll(`${mock.url}?flush=single`);
    const singleFired = single.reads < 2;
    plants.push({ id: "P-sse-single", fired: singleFired, restored: true });
    if (!singleFired) {
      return { verdict: "RED", reason: "single-flush still produced >=2 reads — chunk gate would pass on batched delivery", plants };
    }
    // P-sse-split: mid-frame TCP splits must NOT corrupt the event sequence.
    const split = await readAll(`${mock.url}?split=1&delay=2`);
    const { deltas, sawDone, error } = parseDeltas(split.events);
    const splitOk =
      !error &&
      sawDone &&
      JSON.stringify(deltas) === JSON.stringify(expectedDeltas()) &&
      split.reads >= 8; // at least one read per frame half
    plants.push({ id: "P-sse-split", fired: splitOk, restored: true });
    if (!splitOk) {
      return {
        verdict: "RED",
        reason: "mid-frame splits corrupted incremental parse",
        counts: { reads: split.reads, events: split.events.length },
        plants,
      };
    }
    return {
      verdict: "PASS",
      reason: "plants verified: single-flush trips the chunk gate; mid-frame splits stay correct at event layer",
      counts: { singleReads: single.reads, splitReads: split.reads, splitEvents: split.events.length },
      plants,
    };
  } finally {
    await mock.close();
  }
}
