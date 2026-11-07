// Independent transcript checklist — implemented separately from kernel/src/scenario.rs
// and mp/probe/probe.js. Rows compare reported transcripts against this spec's
// structural expectations; a mismatch in *shape* (not value) is a probe defect.

export const REQUIRED_EFFECTS = [
  "ReadOwner",
  "CasOwner",
  "Restore",
  "StartRuntime",
  "Publish",
  "Complete",
];

/** 解析转录 JSON；结构非法返回错误串。 */
export function parseTranscript(text) {
  if (typeof text !== "string" || text.length === 0) return { error: "transcript empty or not string" };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { error: `transcript JSON parse failed: ${e.message}` };
  }
  if (!doc || typeof doc !== "object") return { error: "transcript not object" };
  if (!Array.isArray(doc.steps)) return { error: "steps missing" };
  if (!doc.tail || typeof doc.tail !== "object") return { error: "tail missing" };
  return { doc };
}

/** 结构断言：冷激活链的关键 effect 必须按序出现，tail 必须 completed_local。 */
export function assertTranscriptShape(doc) {
  const flat = doc.steps.flatMap((s) => s.out ?? []).join("\n");
  let last = -1;
  for (const name of REQUIRED_EFFECTS) {
    const pos = flat.indexOf(name);
    if (pos === -1) return `required effect ${name} absent`;
    if (pos <= last) return `effect order broken at ${name}`;
    last = pos;
  }
  if (doc.tail.completed_local !== true) return "tail.completed_local !== true";
  if (doc.tail.halted === true) return "tail.halted === true";
  if (doc.tail.truncated === true) return "tail.truncated === true";
  return null;
}
