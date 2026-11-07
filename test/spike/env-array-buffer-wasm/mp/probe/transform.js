// MIRROR of test/spike/env-array-buffer-wasm/lib/transform.mjs — keep in sync.
// Divergence between this copy and the lib canonical is itself a finding
// (verified by harness --check on every invocation).
// Deterministic NON-CRYPTO keystream: FNV-1a(label) seed -> LCG32 low byte XOR.
// enc/dec are the same involution. fnv1a32 is a 32-bit FNV-1a checksum used for
// byte-level integrity of the 4MB arm (not a MAC — engine-check parity only).

function seedFromLabel(label) {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function xorCrypt(input, label) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = new Uint8Array(src.length);
  let state = seedFromLabel(label);
  for (let i = 0; i < src.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = src[i] ^ (state & 0xff);
  }
  return out;
}

function fnv1a32(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

module.exports = { xorCrypt, seedFromLabel, fnv1a32 };
