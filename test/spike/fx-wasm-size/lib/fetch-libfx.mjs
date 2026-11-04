// Fetch libfx@0.0.16 npm tarball and extract fx-core.wasm.
// Caches under fixtures/; remoteOps=1 only on first fetch.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const LIBFX_VERSION = "0.0.16";

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function ensureCoreWasm(spikeDir) {
  const fixtures = join(spikeDir, "fixtures");
  const target = join(fixtures, "fx-core.wasm");
  if (existsSync(target)) {
    return { path: target, sha256: sha256File(target), bytes: readFileSync(target).length, remoteOps: 0, cached: true };
  }
  mkdirSync(fixtures, { recursive: true });
  const tgz = execFileSync("npm", ["pack", `libfx@${LIBFX_VERSION}`, "--pack-destination", fixtures], {
    encoding: "utf8",
  }).trim();
  const tgzPath = join(fixtures, tgz.split("\n").pop().trim());
  const extractDir = join(fixtures, "extracted");
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tgzPath, "-C", extractDir]);
  // locate fx-core.wasm inside the package tree
  const found = findFile(extractDir, "fx-core.wasm");
  if (!found) {
    throw new Error(`fx-core.wasm not found in libfx@${LIBFX_VERSION} tarball ${tgzPath}`);
  }
  copyFileSync(found, target);
  return {
    path: target,
    sha256: sha256File(target),
    bytes: readFileSync(target).length,
    remoteOps: 1,
    cached: false,
    tarball: `https://registry.npmjs.org/libfx/-/libfx-${LIBFX_VERSION}.tgz`,
    tarballSha256: sha256File(tgzPath),
    insidePath: found.slice(extractDir.length),
  };
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}
