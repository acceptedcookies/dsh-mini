// Mock OpenAI-style SSE endpoint. Binds 127.0.0.1 only (charter boundary).
// GET /sse            — N flushes at `delay`ms apart, then [DONE]
// GET /sse?flush=single — one flush, whole corpus (P-sse-single plant)
// GET /sse?split=1    — split each frame's data: line across two flushes (P-sse-split plant)
import { createServer } from "node:http";
import { corpusText, makeCorpus } from "../fixtures/corpus.mjs";

export function startMockSse({ delayMs = 40 } = {}) {
  const text = corpusText();
  const frames = text.split("data: ").filter(Boolean).map((f) => `data: ${f}`);
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/sse") {
      res.writeHead(404).end("nope");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "close",
      "transfer-encoding": "chunked",
    });
    const delay = url.searchParams.get("delay") !== null ? Number(url.searchParams.get("delay")) : delayMs;
    if (url.searchParams.get("flush") === "single") {
      res.write(text);
      res.end();
      return;
    }
    if (url.searchParams.get("split") === "1") {
      // split every frame at its midpoint into two flushes
      let i = 0;
      const halves = frames.flatMap((f) => {
        const mid = Math.floor(f.length / 2);
        return [f.slice(0, mid), f.slice(mid)];
      });
      (function next() {
        if (i >= halves.length) return res.end();
        res.write(halves[i++]);
        setTimeout(next, delay);
      })();
      return;
    }
    let i = 0;
    (function next() {
      if (i >= frames.length) return res.end();
      res.write(frames[i++]);
      setTimeout(next, delay);
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}/sse`,
        corpus: makeCorpus(),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
