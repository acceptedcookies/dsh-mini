// spike / nano-tools — wasm-backed content-scan kernel.
//
// Mirrors packages/content-scan-kernel/src/index.ts#wrapKernel against the
// real artifact bytes, without that module's node:fs import (the spike passes
// the artifact in at runtime: H1 reads it from disk, mp would use
// WXWebAssembly). Same ABI, same pair decoding — no semantics re-invented.
import type { ContentScanKernel } from "@nano-agent/content-scan-kernel";

interface KernelExports {
  memory: WebAssembly.Memory;
  cs_init(budget: number): number;
  cs_in_ptr(): number;
  cs_pat_ptr(): number;
  cs_out_ptr(): number;
  cs_cache_budget(): number;
  cs_cache_bytes(): number;
  cs_cache_len(): number;
  cs_entry_overhead(): number;
  cs_last_scanned(): number;
  cs_last_exceeded(): number;
  cs_regex_build(patternLen: number, caseInsensitive: number): number;
  cs_regex_scan(length: number, scanBudget: number, outBudget: number): number;
  cs_defines_scan(length: number, symbolLen: number, caseInsensitive: number, scanBudget: number, outBudget: number): number;
  cs_line_spans(length: number): number;
  cs_symbol_key(symbolLen: number): number;
  cs_extract_syms(length: number): number;
  cs_build_filter(length: number): number;
}

const MISS = 4_294_967_295;
const isMiss = (value: number): boolean => value === -1 || value === MISS;
const enc = new TextEncoder();

export async function createWasmKernel(bytes: ArrayBuffer | Uint8Array): Promise<ContentScanKernel> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { instance } = await WebAssembly.instantiate(source, {});
  const exports = instance.exports as unknown as KernelExports;
  const view = () => new Uint8Array(exports.memory.buffer);
  const writeIn = (data: Uint8Array) => { view().set(data, exports.cs_in_ptr()); };
  const writePat = (data: Uint8Array) => { view().set(data, exports.cs_pat_ptr()); };
  const readOut = (length: number) => view().slice(exports.cs_out_ptr(), exports.cs_out_ptr() + length);
  const readPairs = (count: number) => {
    const out = readOut(count * 8);
    const data = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const pairs: Array<{ start: number; length: number }> = [];
    for (let index = 0; index < count; index += 1) {
      pairs.push({ start: data.getUint32(index * 8, true), length: data.getUint32(index * 8 + 4, true) });
    }
    return pairs;
  };
  const kernel: ContentScanKernel = {
    memory: exports.memory,
    init: (budget) => exports.cs_init(budget),
    cacheBudget: () => exports.cs_cache_budget(),
    cacheBytes: () => exports.cs_cache_bytes(),
    cacheLen: () => exports.cs_cache_len(),
    entryOverhead: () => exports.cs_entry_overhead(),
    lastScanned: () => exports.cs_last_scanned(),
    lastExceeded: () => exports.cs_last_exceeded() !== 0,
    cachePut: async () => false,
    cacheGet: () => null,
    cacheScanRegex: () => null,
    cacheScanDefines: () => null,
    cacheFilter: () => null,
    bloomProbe: () => null,
    buildFilter(content: Uint8Array) {
      writeIn(content);
      const length = exports.cs_build_filter(content.length);
      if (isMiss(length)) throw new Error("content scan kernel filter build failed");
      return readOut(length);
    },
    regexBuild(pattern: string, caseInsensitive: boolean) {
      const data = enc.encode(pattern);
      writePat(data);
      return exports.cs_regex_build(data.length, caseInsensitive ? 1 : 0) as 0 | 1 | 2;
    },
    regexScan(content: Uint8Array, scanBudget: number, outBudget: number) {
      writeIn(content);
      const count = exports.cs_regex_scan(content.length, scanBudget, outBudget);
      if (isMiss(count)) throw new Error("content scan kernel regex is not built");
      return readPairs(count);
    },
    definesScan(content: Uint8Array, symbol: string, caseInsensitive: boolean, scanBudget: number, outBudget: number) {
      writeIn(content);
      const data = enc.encode(symbol);
      writePat(data);
      const count = exports.cs_defines_scan(content.length, data.length, caseInsensitive ? 1 : 0, scanBudget, outBudget);
      if (isMiss(count)) throw new Error("content scan kernel defines scan failed");
      return readPairs(count);
    },
    lineSpans(line: Uint8Array) {
      writeIn(line);
      const count = exports.cs_line_spans(line.length);
      if (isMiss(count)) throw new Error("content scan kernel line spans failed");
      return readPairs(count);
    },
    symbolKey(name: string) {
      const data = enc.encode(name);
      writePat(data);
      return exports.cs_symbol_key(data.length) >>> 0;
    },
    extractSyms(content: Uint8Array) {
      writeIn(content);
      const count = exports.cs_extract_syms(content.length);
      if (isMiss(count)) throw new Error("content scan kernel syms extraction failed");
      const out = readOut(count * 4);
      const data = new DataView(out.buffer, out.byteOffset, out.byteLength);
      return Array.from({ length: count }, (_, index) => data.getUint32(index * 4, true));
    },
    rebuild: () => "",
    scratchZeroed: () => true,
  };
  kernel.init(33_554_432);
  return kernel;
}
