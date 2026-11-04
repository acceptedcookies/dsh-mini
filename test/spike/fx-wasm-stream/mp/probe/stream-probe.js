// wx.request chunked probe for the sim/device lanes.
// runStreamProbe(url, { abortAfterFirst }) resolves a result object:
//   { chunks, chunkBytes[], events[], deltas[], sawDone, aborted, lateChunks, error }
const { createSseParser, parseDeltas } = require("./sse-parser.js");

function runStreamProbe(url, opts) {
  const abortAfterFirst = !!(opts && opts.abortAfterFirst);
  return new Promise((resolve) => {
    const parser = createSseParser();
    const result = {
      url,
      mode: abortAfterFirst ? "abort" : "full",
      chunks: 0,
      chunkBytes: [],
      events: [],
      deltas: [],
      sawDone: false,
      aborted: false,
      lateChunks: 0,
      error: null,
      settled: false,
    };
    let aborting = false;
    let finished = false;
    const finish = (extra) => {
      if (finished) return;
      finished = true;
      const { deltas, sawDone, error } = parseDeltas(result.events);
      result.deltas = deltas;
      result.sawDone = sawDone;
      if (error) result.error = error;
      if (extra) Object.assign(result, extra);
      resolve(result);
    };
    let task;
    try {
      task = wx.request({
        url,
        method: "GET",
        enableChunked: true,
        responseType: "arraybuffer",
        success: () => {},
        fail: (err) => finish({ error: `request fail: ${(err && err.errMsg) || err}` }),
        complete: () => {
          // settle slightly later to observe any late chunks post-abort
          setTimeout(() => finish(), aborting ? 800 : 50);
        },
      });
    } catch (e) {
      finish({ error: `request threw: ${(e && e.message) || e}` });
      return;
    }
    task.onChunkReceived((res) => {
      if (aborting) {
        result.lateChunks += 1;
        return;
      }
      result.chunks += 1;
      const n = res && res.data ? res.data.byteLength : 0;
      result.chunkBytes.push(n);
      try {
        const ev = parser.feed(res.data);
        for (const e of ev) result.events.push(e);
      } catch (e) {
        finish({ error: `parse threw: ${(e && e.message) || e}` });
        return;
      }
      if (abortAfterFirst) {
        aborting = true;
        result.aborted = true;
        try {
          task.abort();
        } catch (e) {
          finish({ error: `abort threw: ${(e && e.message) || e}` });
        }
      }
    });
    // hard timeout guard
    setTimeout(() => {
      if (!finished) finish({ error: "probe timeout 30s" });
    }, 30000);
  });
}

module.exports = { runStreamProbe };
