// Incremental SSE parser (implementation A — mp side).
// Mirrors test/spike/fx-wasm-stream/lib/sse-parser.mjs — keep in sync;
// divergence is a finding. ASCII-only decode (corpus is ASCII by construction),
// avoiding reliance on TextDecoder presence in the mp runtime.

function bytesToAscii(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
}

function createSseParser() {
  let carry = "";
  return {
    feed(bytes) {
      if (typeof bytes === "string") {
        carry += bytes;
      } else if (bytes instanceof ArrayBuffer) {
        carry += bytesToAscii(new Uint8Array(bytes));
      } else {
        carry += bytesToAscii(new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength));
      }
      const events = [];
      let idx;
      while ((idx = carry.indexOf("\n\n")) >= 0) {
        const block = carry.slice(0, idx);
        carry = carry.slice(idx + 2);
        const lines = block.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.indexOf("data:") === 0) {
            events.push(line.slice(5).replace(/^ /, ""));
          }
        }
      }
      return events;
    },
  };
}

function parseDeltas(dataEvents) {
  const deltas = [];
  let sawDone = false;
  for (const raw of dataEvents) {
    if (raw === "[DONE]") {
      sawDone = true;
      continue;
    }
    try {
      const obj = JSON.parse(raw);
      const c = obj && obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
      if (typeof c === "string") deltas.push(c);
    } catch (e) {
      return { deltas, sawDone, error: String((e && e.message) || e) };
    }
  }
  return { deltas, sawDone };
}

module.exports = { createSseParser, parseDeltas };
