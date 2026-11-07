// wat -> wasm via wabt; --build artifact generation (charter §3.7 step 1).
// Artifacts are gitignored and regenerable: fixtures/{echo,bad,evil}.wasm,
// fixtures/echo.enc, mp/wasm/echo.wasm, fixtures/fx-core-async.wasm (copied from
// the sibling fx-wasm-agent spike when present — absent only gates AB-H3/AB-S3).
// NOTE: the server computes .enc payloads on the fly from .wasm; fixtures/*.enc
// written here are existence markers that --build ran (and offline debugging).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import wabtFn from "wabt";
import { xorCrypt } from "./transform.mjs";

let wabtPromise = null;
function wabt() {
  wabtPromise ??= wabtFn();
  return wabtPromise;
}

export async function watToWasm(source) {
  const w = await wabt();
  const parsed = w.parseWat("spike.wat", source);
  const { buffer } = parsed.toBinary({});
  return new Uint8Array(buffer);
}

export async function buildAll(spikeDir) {
  const fixtures = join(spikeDir, "fixtures");
  const mpWasm = join(spikeDir, "mp", "wasm");
  mkdirSync(fixtures, { recursive: true });
  mkdirSync(mpWasm, { recursive: true });
  const outs = [];
  for (const name of ["echo", "bad", "evil"]) {
    const wat = readFileSync(join(fixtures, `${name}.wat`), "utf8");
    const bytes = await watToWasm(wat);
    writeFileSync(join(fixtures, `${name}.wasm`), bytes);
    outs.push(`fixtures/${name}.wasm ${bytes.length}B`);
    if (name === "echo") writeFileSync(join(mpWasm, "echo.wasm"), bytes);
  }
  const echoBytes = readFileSync(join(fixtures, "echo.wasm"));
  writeFileSync(join(fixtures, "echo.enc"), xorCrypt(echoBytes, "echo"));
  outs.push("fixtures/echo.enc (marker; server computes live)");
  const srcFx = join(spikeDir, "..", "fx-wasm-agent", "fixtures", "fx-core-async.wasm");
  const dstFx = join(fixtures, "fx-core-async.wasm");
  if (existsSync(srcFx)) {
    copyFileSync(srcFx, dstFx);
    outs.push(`fixtures/fx-core-async.wasm ${readFileSync(dstFx).length}B (from fx-wasm-agent)`);
  } else {
    console.log("build: fx-core-async.wasm source absent (fx-wasm-agent fixture missing) — AB-H3/AB-S3 will NOT_RUN");
  }
  for (const o of outs) console.log(`build: ${o}`);
}
