// spike / nano-tools — TS simulation of the content-scan kernel.
//
// nano-agent ships rg's scan surface as a Rust→wasm kernel
// (packages/content-scan-kernel). workerd/Node can instantiate that artifact;
// the mini-program appservice cannot (WXWebAssembly is worker-only), so the
// spike runs the SAME handler (capabilities/search.ts) against a TS
// re-implementation of the kernel ABI. Semantics mirrored here:
//   regexBuild / regexScan / definesScan / lastScanned / lastExceeded
// plus the cheap helpers the host asks for. Everything else is a faithful
// "not cached" answer (cachePut false / cacheGet null) — the spike never
// enables the kernel cache path.
import type { ContentScanKernel } from "@nano-agent/content-scan-kernel";

const enc = new TextEncoder();
const dec = new TextDecoder();

const WORD = /[A-Za-z0-9_$]/;

function byteLen(text: string): number {
  return enc.encode(text).byteLength;
}

export function createTsKernel(): ContentScanKernel {
  let compiled: RegExp | null = null;
  let scanned = 0;
  let exceeded = false;

  const scan = (content: Uint8Array, scanBudget: number, outBudget: number): Array<{ start: number; length: number }> => {
    const limit = Math.max(0, Math.min(content.byteLength, scanBudget));
    scanned = limit;
    exceeded = content.byteLength > limit;
    if (!compiled) throw new Error("content scan kernel regex is not built");
    const text = dec.decode(content.subarray(0, limit));
    const re = new RegExp(compiled.source, compiled.flags.includes("g") ? compiled.flags : `${compiled.flags}g`);
    const out: Array<{ start: number; length: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      out.push({ start: byteLen(text.slice(0, match.index)), length: byteLen(match[0]) });
      if (out.length >= outBudget) break;
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
    return out;
  };

  return {
    memory: typeof WebAssembly !== "undefined" && WebAssembly.Memory ? new WebAssembly.Memory({ initial: 1 }) : ({} as WebAssembly.Memory),
    init: () => 0,
    cacheBudget: () => 0,
    cacheBytes: () => 0,
    cacheLen: () => 0,
    entryOverhead: () => 0,
    lastScanned: () => scanned,
    lastExceeded: () => exceeded,
    cachePut: async () => false,
    cacheGet: () => null,
    cacheScanRegex: () => null,
    cacheScanDefines: () => null,
    cacheFilter: () => null,
    bloomProbe: () => null,
    buildFilter: () => new Uint8Array(0),
    regexBuild(pattern: string, caseInsensitive: boolean) {
      try {
        compiled = new RegExp(pattern, caseInsensitive ? "i" : "");
        return 0;
      } catch {
        compiled = null;
        return 1;
      }
    },
    regexScan: scan,
    definesScan(content: Uint8Array, symbol: string, caseInsensitive: boolean, scanBudget: number, outBudget: number) {
      const limit = Math.max(0, Math.min(content.byteLength, scanBudget));
      scanned = limit;
      exceeded = content.byteLength > limit;
      const text = dec.decode(content.subarray(0, limit));
      const haystack = caseInsensitive ? text.toLowerCase() : text;
      const needle = caseInsensitive ? symbol.toLowerCase() : symbol;
      const out: Array<{ start: number; length: number }> = [];
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at < 0) break;
        const before = at === 0 ? "" : haystack[at - 1]!;
        const after = haystack[at + needle.length] ?? "";
        const isDefine = (before === "" || !WORD.test(before)) && (after === "" || !WORD.test(after));
        if (isDefine) {
          out.push({ start: byteLen(text.slice(0, at)), length: byteLen(symbol) });
          if (out.length >= outBudget) break;
        }
        from = at + needle.length;
      }
      return out;
    },
    lineSpans(line: Uint8Array) {
      const text = dec.decode(line);
      const out: Array<{ start: number; length: number }> = [];
      let from = 0;
      for (;;) {
        const at = text.indexOf("\n", from);
        const end = at < 0 ? text.length : at;
        out.push({ start: byteLen(text.slice(0, from)), length: byteLen(text.slice(from, end)) });
        if (at < 0) break;
        from = at + 1;
      }
      return out;
    },
    symbolKey(name: string) {
      let hash = 2166136261;
      const bytes = enc.encode(name);
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return hash >>> 0;
    },
    extractSyms(content: Uint8Array) {
      const text = dec.decode(content);
      const seen = new Set<number>();
      const re = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        let hash = 2166136261;
        for (const byte of enc.encode(match[0])) {
          hash ^= byte;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        seen.add(hash >>> 0);
      }
      return [...seen];
    },
    rebuild: () => "",
    scratchZeroed: () => true,
  };
}
