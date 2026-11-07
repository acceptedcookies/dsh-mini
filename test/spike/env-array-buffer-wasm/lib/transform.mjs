// Deterministic NON-CRYPTO keystream transform — pipeline timing stand-in only
// (charter §3.3: 密文强度不在本 spike 范围).
// enc/dec are the same involution: xorCrypt(xorCrypt(b,label),label) === b.
// Keystream: FNV-1a(label) seed -> LCG32 (state = state*1664525 + 1013904223
// mod 2^32, low byte per position). All ops are exact in JS doubles/imul, so the
// stream is identical across Node and the mini-program JS engine.
// MUST stay byte-identical with mp/probe/transform.js (sim/device lanes) —
// divergence is itself a finding; `harness/run.mjs --check` verifies the mirror
// on every invocation.

export function seedFromLabel(label) {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function xorCrypt(input, label) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = new Uint8Array(src.length);
  let state = seedFromLabel(label);
  for (let i = 0; i < src.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = src[i] ^ (state & 0xff);
  }
  return out;
}

export function fnv1a32(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
