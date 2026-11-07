// 真机 preview 结果接收器：POST /probe → golden 对照 → evidence receipt。
import { createServer } from "node:http";
import { buildReceipts } from "./receipts.mjs";

const SPIKE = "/Users/seanz/Documents/dsh-mini/test/spike/env-celld-wasm";

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/probe")) { res.writeHead(404); return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    let r;
    try { r = JSON.parse(body); } catch (e) { return console.log("bad json", e.message); }
    const out = buildReceipts(r, "ec-r", "preview qr -> wx.request callback (zero remote-debug)");
    console.log(JSON.stringify(out, null, 1));

  });
});
server.listen(18081, "0.0.0.0", () => console.log("result-server on :18081"));
