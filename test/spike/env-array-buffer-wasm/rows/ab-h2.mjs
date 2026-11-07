// AB-H2 — mock 服务 + Node fetch 管线对照臂 (V-A3 host control, charter §3.3/§3.7)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startMockWasm } from "../lib/wasm-server.mjs";
import { xorCrypt } from "../lib/transform.mjs";

function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function toAB(u8) {
  if (u8.byteOffset === 0 && u8.buffer.byteLength === u8.byteLength) return u8.buffer;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

export async function run(ctx) {
  const { spikeDir } = ctx;
  const fixtures = join(spikeDir, "fixtures");
  if (!existsSync(join(fixtures, "echo.wasm")) || !existsSync(join(fixtures, "echo.enc"))) {
    return { verdict: "NOT_RUN", reason: "fixtures/echo.wasm|echo.enc missing; run `node harness/run.mjs --build` first" };
  }
  const mock = await startMockWasm({ fixturesDir: fixtures });
  const plants = [];
  let httpOps = 0;
  let httpBytes = 0;
  const fetchBytes = async (url) => {
    httpOps += 1;
    const t0 = performance.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const buf = await res.arrayBuffer();
    httpBytes += buf.byteLength;
    return { bytes: toU8(buf), ms: Math.round((performance.now() - t0) * 10) / 10 };
  };
  try {
    // main arm: fetch enc -> decrypt -> Module -> Instance -> echo()=42
    const enc = await fetchBytes(`${mock.url}/echo.enc`);
    const t0 = performance.now();
    const plain = xorCrypt(enc.bytes, "echo");
    const decryptMs = Math.round((performance.now() - t0) * 10) / 10;
    const raw = await fetchBytes(`${mock.url}/echo.wasm`);
    let roundtripEq = plain.length === raw.bytes.length;
    if (roundtripEq) for (let i = 0; i < plain.length; i++) if (plain[i] !== raw.bytes[i]) { roundtripEq = false; break; }
    const t1 = performance.now();
    const mod = new WebAssembly.Module(toAB(plain));
    const compileMs = Math.round((performance.now() - t1) * 10) / 10;
    const t2 = performance.now();
    const inst = new WebAssembly.Instance(mod, {});
    const linkMs = Math.round((performance.now() - t2) * 10) / 10;
    const value = inst.exports.echo();

    // P-wrong-key: wrong-label ciphertext decrypted with correct label must fail Module
    const badKey = await fetchBytes(`${mock.url}/echo.enc?key=bad`);
    const badPlain = xorCrypt(badKey.bytes, "echo");
    let wrongKeyThrew = false;
    let wrongKeyName = null;
    try {
      new WebAssembly.Module(toAB(badPlain));
    } catch (e) {
      wrongKeyThrew = true;
      wrongKeyName = e.name;
    }
    plants.push({ id: "P-wrong-key", fired: wrongKeyThrew, restored: value === 42 });

    // P-trunc-wasm: truncated ciphertext must fail Module
    const trunc = await fetchBytes(`${mock.url}/echo.enc?trunc=half`);
    const truncPlain = xorCrypt(trunc.bytes, "echo");
    let truncThrew = false;
    let truncName = null;
    try {
      new WebAssembly.Module(toAB(truncPlain));
    } catch (e) {
      truncThrew = true;
      truncName = e.name;
    }
    plants.push({ id: "P-trunc-wasm", fired: truncThrew, restored: value === 42 });

    // P-bytes-bad (link arm): bad.wasm compiles, Instance must throw
    const badRes = await fetchBytes(`${mock.url}/bad.wasm`);
    let badModuleThrew = false;
    let badLinkThrew = false;
    try {
      const badMod = new WebAssembly.Module(toAB(badRes.bytes));
      try {
        new WebAssembly.Instance(badMod, {});
      } catch {
        badLinkThrew = true;
      }
    } catch {
      badModuleThrew = true;
    }
    plants.push({ id: "P-bytes-bad", fired: badModuleThrew || badLinkThrew, restored: value === 42 });

    // P-valid-swap: valid-but-wrong module (echo()=7) must NOT be rejected —
    // proves engine validates format, not integrity (MAC is a caller duty)
    const evil = await fetchBytes(`${mock.url}/evil.enc`);
    const evilPlain = xorCrypt(evil.bytes, "echo");
    let validSwapModuleOk = false;
    let validSwapValue = null;
    try {
      const evilMod = new WebAssembly.Module(toAB(evilPlain));
      validSwapModuleOk = true;
      validSwapValue = new WebAssembly.Instance(evilMod, {}).exports.echo();
    } catch {}
    const validSwapNotRejected = validSwapModuleOk === true && validSwapValue !== 42;
    plants.push({ id: "P-valid-swap", fired: validSwapNotRejected, restored: value === 42 });

    const checks = {
      valueIs42: value === 42,
      roundtripEq,
      wrongKeyThrew,
      truncThrew,
      badLinkThrew,
      validSwapNotRejected,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    const budgetUsed = { objects: 3, ops: httpOps, bytes: httpBytes };
    const detail = {
      timings: { fetchMs: enc.ms, decryptMs, compileMs, linkMs },
      errorNames: { wrongKey: wrongKeyName, trunc: truncName },
      validSwapValue,
      mock: { bind: mock.bind, port: mock.port },
    };
    if (failed.length) {
      return {
        verdict: "RED",
        reason: `host pipeline checks failed: ${failed.join(",")}`,
        counts: { value },
        plants,
        budgetUsed,
        detail,
      };
    }
    return {
      verdict: "PASS",
      reason:
        "host pipeline: fetch->decrypt->Module->Instance->echo()=42 with roundtrip equality; wrong-key/trunc/bad-link rejected (names recorded); valid-but-wrong module NOT rejected — engine validates format not integrity",
      counts: { value, encBytes: enc.bytes.length },
      plants,
      budgetUsed,
      detail,
    };
  } finally {
    await mock.close();
  }
}
