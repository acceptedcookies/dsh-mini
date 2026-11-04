// wasm section census — self-parsing, no external tools.
// Section ids per wasm spec: 0 custom, 1 type, 2 import, 3 function, 4 table,
// 5 memory, 6 global, 7 export, 8 start, 9 elem, 10 code, 11 data, 12 datacount.
import { readFileSync } from "node:fs";

const NAMES = {
  0: "custom",
  1: "type",
  2: "import",
  3: "function",
  4: "table",
  5: "memory",
  6: "global",
  7: "export",
  8: "start",
  9: "elem",
  10: "code",
  11: "data",
  12: "datacount",
};

function readU32(buf, pos) {
  let result = 0;
  let shift = 0;
  while (true) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

export function sectionCensus(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x6d736100) throw new Error("not a wasm binary (bad magic)");
  const sections = [];
  let pos = 8;
  while (pos < buf.length) {
    const id = buf[pos++];
    const [size, bodyStart] = readU32(buf, pos);
    const section = { id, name: NAMES[id] ?? `unknown-${id}`, size, start: pos - 1 };
    if (id === 0) {
      // custom section: first field is name (len-prefixed)
      const [nameLen, nameStart] = readU32(buf, bodyStart);
      section.customName = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    }
    sections.push(section);
    pos = bodyStart + size;
  }
  return { total: buf.length, sections };
}

export function censusSummary(census) {
  const byName = {};
  for (const s of census.sections) {
    const key = s.id === 0 ? `custom:${s.customName}` : s.name;
    byName[key] = (byName[key] ?? 0) + s.size;
  }
  return byName;
}
