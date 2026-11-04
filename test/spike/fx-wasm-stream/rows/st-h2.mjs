// ST-H2 — 解析器边界枚举 (V-T1): 任意重分块后事件序列与整包解析全等
import { createSseParser } from "../lib/sse-parser.mjs";
import { parseWhole } from "../ref/sse-whole.mjs";
import { corpusText } from "../fixtures/corpus.mjs";

function feedChunked(parser, bytes, boundaries) {
  const events = [];
  let pos = 0;
  for (const b of boundaries) {
    events.push(...parser.feed(bytes.subarray(pos, b)));
    pos = b;
  }
  events.push(...parser.feed(bytes.subarray(pos)));
  return events;
}

export async function run(ctx) {
  const text = corpusText();
  const bytes = new TextEncoder().encode(text);
  const whole = parseWhole(text);

  const cases = [];
  // every single byte (small prefix to bound ops) + deterministic stride boundaries
  cases.push({ name: "whole", bounds: [] });
  cases.push({ name: "every-byte-1..256", bounds: Array.from({ length: 256 }, (_, i) => i + 1) });
  cases.push({ name: "stride-7", bounds: range(7, bytes.length, 7) });
  cases.push({ name: "stride-1", bounds: range(1, bytes.length, 1) });
  cases.push({ name: "mid-frame-13", bounds: range(13, bytes.length, 13) });
  // split inside 'data:' tokens specifically: boundary at every newline and
  // every newline+1 (frame boundaries and their neighbors)
  const nl = [];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) nl.push(i + 1, i + 2);
  cases.push({ name: "newline-edges", bounds: dedupeSort(nl.filter((b) => b < bytes.length)) });

  let firstMismatch = null;
  for (const c of cases) {
    const parser = createSseParser();
    const events = feedChunked(parser, bytes, c.bounds);
    if (JSON.stringify(events) !== JSON.stringify(whole)) {
      firstMismatch = c.name;
      break;
    }
  }
  if (firstMismatch) {
    return { verdict: "RED", reason: `incremental parse diverges at case ${firstMismatch}` };
  }
  return {
    verdict: "PASS",
    reason: `${cases.length} rechunking cases all equal whole-buffer parse (${whole.length} events)`,
    counts: { cases: cases.length, events: whole.length, corpusBytes: bytes.length },
  };
}

function range(start, end, step) {
  const out = [];
  for (let i = start; i < end; i += step) out.push(i);
  return out;
}
function dedupeSort(a) {
  return [...new Set(a)].sort((x, y) => x - y);
}
