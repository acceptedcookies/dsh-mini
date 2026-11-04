// ST-H1 — Node fetch 对照臂 (V-T2)
import { startMockSse } from "../lib/sse-server.mjs";
import { createSseParser, parseDeltas } from "../lib/sse-parser.mjs";
import { parseWhole } from "../ref/sse-whole.mjs";
import { expectedDeltas, makeCorpus, corpusText } from "../fixtures/corpus.mjs";

export async function run(ctx) {
  const mock = await startMockSse({ delayMs: 40 });
  try {
    const res = await fetch(mock.url);
    if (!res.ok || !res.body) {
      return { verdict: "RED", reason: `mock fetch failed: status ${res.status}` };
    }
    const parser = createSseParser();
    const reader = res.body.getReader();
    let reads = 0;
    const all = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reads += 1;
      for (const e of parser.feed(value)) all.push(e);
    }
    const { deltas, sawDone, error } = parseDeltas(all);
    if (error) return { verdict: "RED", reason: `parse error: ${error}` };
    const expected = expectedDeltas();
    const wholeEq = JSON.stringify(parseWhole(corpusText())) === JSON.stringify(all);
    const checks = {
      readsGe2: reads >= 2,
      deltasEq: JSON.stringify(deltas) === JSON.stringify(expected),
      sawDone,
      incrementalEqWhole: wholeEq,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `control arm failed: ${failed.join(",")}`,
        counts: { reads, events: all.length },
        detail: { deltas, expected },
      };
    }
    return {
      verdict: "PASS",
      reason: "control arm: chunked reads >=2, incremental == whole == corpus",
      counts: { reads, events: all.length, deltas: deltas.length },
    };
  } finally {
    await mock.close();
  }
}
