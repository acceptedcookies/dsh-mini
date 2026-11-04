// Whole-buffer SSE parser (implementation B — independent compare arm).
// Deliberately different structure from lib/sse-parser.mjs: split the whole
// text on blank lines, no incremental state.

export function parseWhole(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        events.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  return events;
}
