// Incremental SSE parser (implementation A — host side).
// Feed arbitrary byte chunks; emit completed `data:` payloads per event.
// Mirrors mp/probe/sse-parser.js — keep the two in sync; divergence is a finding.

export function createSseParser() {
  let carry = "";
  const decoder = new TextDecoder();
  return {
    feed(bytes) {
      carry += typeof bytes === "string" ? bytes : decoder.decode(bytes, { stream: true });
      const events = [];
      let idx;
      while ((idx = carry.indexOf("\n\n")) >= 0) {
        const block = carry.slice(0, idx);
        carry = carry.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) {
            events.push(line.slice(5).replace(/^ /, ""));
          }
        }
      }
      return events;
    },
    flush() {
      const rest = carry;
      carry = "";
      return rest;
    },
  };
}

export function parseDeltas(dataEvents) {
  const deltas = [];
  let sawDone = false;
  for (const raw of dataEvents) {
    if (raw === "[DONE]") {
      sawDone = true;
      continue;
    }
    const obj = JSON.parse(raw);
    const c = obj.choices?.[0]?.delta?.content;
    if (typeof c === "string") deltas.push(c);
  }
  return { deltas, sawDone };
}
