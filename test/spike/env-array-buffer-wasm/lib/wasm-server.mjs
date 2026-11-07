// Mock wasm-byte endpoint. Binds 127.0.0.1 only by default (charter boundary);
// SPIKE_MOCK_LAN=1 or lan:true binds 0.0.0.0 for the owner-gated device lane —
// the bind fact and advertised LAN URL are recorded into row detail.
// Files are read per request, so --build artifacts dropped in after server
// start are still served.
//   GET  /echo.wasm            raw control bytes
//   GET  /bad.wasm             missing-import module (LinkError plant)
//   GET  /evil.wasm            valid-but-wrong module (echo()=7)
//   GET  /echo.enc             XOR ciphertext; ?key=bad -> wrong label;
//                              ?trunc=half|N -> ciphertext prefix slice
//   GET  /evil.enc             valid-but-wrong ciphertext (label "echo") —
//                              decrypts to a legal module with wrong output
//   GET  /fx-core-async.enc    4MB-class ciphertext (404 when fixture absent)
//   GET  /fx-core-async.fnv    FNV-1a32 of raw fx wasm (plaintext checksum)
//   POST /report               device lane evidence sink — writes JSON body to
//                              <evidenceDir>/device-report-<UTC>.json
// Standalone (device lane): node lib/wasm-server.mjs --dir ../fixtures --lan
//                           [--evidence ../evidence/device] [--port N]
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { xorCrypt, fnv1a32 } from "./transform.mjs";

function lanIp() {
  for (const name of Object.keys(networkInterfaces())) {
    for (const ni of networkInterfaces()[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

export async function startMockWasm({ fixturesDir, evidenceDir, lan } = {}) {
  const dir = fixturesDir;
  const lanOn = lan === true || process.env.SPIKE_MOCK_LAN === "1";
  const read = (name) => {
    const p = join(dir, name);
    return existsSync(p) ? readFileSync(p) : null;
  };
  const send = (res, bytes, type = "application/wasm") => {
    res.writeHead(200, {
      "content-type": type,
      "content-length": bytes.length,
      "cache-control": "no-store",
    });
    res.end(bytes);
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;
    try {
      if (p === "/echo.wasm" || p === "/bad.wasm" || p === "/evil.wasm") {
        const b = read(p.slice(1));
        if (!b) return res.writeHead(404).end("missing fixture; run --build first");
        return send(res, b);
      }
      if (p === "/echo.enc" || p === "/evil.enc") {
        const raw = read(`${p.slice(1, -4)}.wasm`);
        if (!raw) return res.writeHead(404).end("missing fixture; run --build first");
        const label = url.searchParams.get("key") === "bad" ? "echo-bad" : "echo";
        let enc = xorCrypt(raw, label);
        const trunc = url.searchParams.get("trunc");
        if (trunc !== null) {
          const n =
            trunc === "half"
              ? Math.floor(enc.length / 2)
              : Math.max(0, Math.min(enc.length, Number(trunc) || 0));
          enc = enc.slice(0, n);
        }
        return send(res, enc);
      }
      if (p === "/fx-core-async.enc") {
        const raw = read("fx-core-async.wasm");
        if (!raw)
          return res
            .writeHead(404)
            .end("fx fixture absent; run --build with fx-wasm-agent fixture present");
        const label =
          url.searchParams.get("key") === "bad" ? "fx-core-async-bad" : "fx-core-async";
        return send(res, xorCrypt(raw, label));
      }
      if (p === "/fx-core-async.fnv") {
        const raw = read("fx-core-async.wasm");
        if (!raw) return res.writeHead(404).end("fx fixture absent");
        return send(res, fnv1a32(raw), "text/plain");
      }
      if (p === "/report" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const outDir = evidenceDir || join(dir, "..", "evidence", "device");
            mkdirSync(outDir, { recursive: true });
            const file = join(
              outDir,
              `device-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
            );
            writeFileSync(file, body);
            console.log(`[mock] report written: ${file}`);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.writeHead(500).end(String((e && e.message) || e));
          }
        });
        return;
      }
      res.writeHead(404).end("nope");
    } catch (e) {
      res.writeHead(500).end(String((e && e.stack) || e));
    }
  });
  const bind = lanOn ? "0.0.0.0" : "127.0.0.1";
  return new Promise((resolveP) => {
    server.listen(0, bind, () => {
      const port = server.address().port;
      const ip = lanIp();
      resolveP({
        server,
        port,
        bind,
        url: `http://127.0.0.1:${port}`,
        lanUrl: ip ? `http://${ip}:${port}` : null,
        close: () =>
          new Promise((r) => {
            try {
              server.closeAllConnections?.();
            } catch {}
            server.close(r);
          }),
      });
    });
  });
}

// Standalone entry for the owner-gated device lane:
//   node lib/wasm-server.mjs --dir <fixturesDir> --lan [--evidence <dir>] [--port N]
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : null;
  };
  const dir = resolve(get("--dir") || join(process.cwd(), "fixtures"));
  const evidenceDir = get("--evidence") ? resolve(get("--evidence")) : undefined;
  const lanFlag = args.includes("--lan") || process.env.SPIKE_MOCK_LAN === "1";
  if (!existsSync(dir)) {
    console.error(`fixtures dir missing: ${dir}`);
    process.exit(1);
  }
  startMockWasm({ fixturesDir: dir, evidenceDir, lan: lanFlag }).then((m) => {
    console.log(`[mock] bind=${m.bind} port=${m.port}`);
    console.log(`[mock] loopback: ${m.url}`);
    if (m.lanUrl) console.log(`[mock] LAN:      ${m.lanUrl}  <- enter this in the device page`);
    console.log(`[mock] report sink: ${evidenceDir || join(dir, "..", "evidence", "device")}`);
  });
}
