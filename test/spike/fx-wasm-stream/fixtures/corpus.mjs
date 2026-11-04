// Deterministic SSE corpus — single source for mock server, host parser,
// and mp probe comparison. ASCII only (manual decode on mp side).

export function makeCorpus() {
  const events = [];
  for (let i = 0; i < 8; i++) {
    events.push({
      id: "spike",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: `delta-${i} ${"x".repeat(i + 3)}` } }],
    });
  }
  return events;
}

export function corpusText(events = makeCorpus()) {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
}

export function expectedDeltas(events = makeCorpus()) {
  return events.map((e) => e.choices[0].delta.content);
}
