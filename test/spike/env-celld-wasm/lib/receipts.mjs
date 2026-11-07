// 共享 receipt 构造：从 probe report 生成 L3/L4/L1 三份证据（sim=R*, device=R*）。
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPIKE = "/Users/seanz/Documents/dsh-mini/test/spike/env-celld-wasm";
const golden = () => readFileSync(join(SPIKE, "fixtures", "golden-transcript.txt"), "utf8");

export function buildReceipts(report, prefix, transport) {
  const d = report.device ?? {}, b = report.base ?? {};
  const plat = `${d.brand ?? ""} ${d.model ?? ""} ${d.platform ?? ""} ${d.system ?? ""}`.toLowerCase();
  const lane = /ios|iphone|ipad|apple/.test(plat) ? "1" : /android/.test(plat) ? "2" : null;
  const envClass = lane === "1" ? "ios" : lane === "2" ? "android" : prefix === "ec-s" ? "devtools-sim" : "unknown";
  const device = {
    brand: d.brand ?? null, model: d.model ?? null, platform: d.platform ?? null, system: d.system ?? null,
    wechatVersion: b.version ?? null, baseLibVersion: b.SDKVersion ?? null,
  };
  const base = { lane: prefix === "ec-s" ? "sim" : "device", at: new Date().toISOString(), device, transport, envClass };

  const g = golden();
  const s1 = report.celld ?? {};
  const exact = (s1.transcript ?? "") === g;
  const l3 = report.l3 ?? {}, l4 = report.l4 ?? {}, l1 = report.l1 ?? {};

  const receipts = [
    { id: `${prefix}2`, grade: prefix === "ec-s" ? "S1" : "R2", section: "S1", verdict: exact && s1.instantiateOk ? "PASS" : "RED",
      reason: exact ? `transcript byte-exact vs golden (${(s1.transcript ?? "").length}B)` : "transcript mismatch",
      counts: { transcriptBytes: (s1.transcript ?? "").length, memoryBytes: s1.memoryBytes ?? null, instantiateMs: s1.instantiateMs ?? null } },
    { id: `${prefix}3`, grade: prefix === "ec-s" ? "S2" : "R3", section: "L3", verdict: l3.ok ? "PASS" : "RED",
      reason: l3.ok ? `effect bridge: ${(l3.hostCalls ?? []).length} host calls, completed_local, owner/state persisted` : (l3.error ?? "L3 failed"),
      counts: { hostCalls: (l3.hostCalls ?? []).length, steps: l3.steps ?? null, transcriptBytes: l3.transcriptBytes ?? null },
      detail: { hostCalls: l3.hostCalls ?? [], ownerPersisted: l3.ownerPersisted, statePersisted: l3.statePersisted } },
    { id: `${prefix}4`, grade: prefix === "ec-s" ? "S3" : "R4", section: "L4", verdict: l4.ok ? "PASS" : "RED",
      reason: l4.ok ? `cross-instance durability: fresh ReadOwner=${l4.freshReadOwner} warm ReadOwner=${l4.warmReadOwner}, transcripts differ` : (l4.error ?? "L4 failed"),
      counts: { warmSteps: l4.warmSteps ?? null },
      detail: l4 },
    { id: `${prefix}5`, grade: prefix === "ec-s" ? "S4" : "R5", section: "L1",
      verdict: l1.isolation?.ok ? (l1.engine?.jsRan ? "PASS" : "PARTIAL") : "RED",
      reason: l1.isolation?.ok
        ? `multi-instance isolation ok (memories distinct ${l1.isolation.memory1}/${l1.isolation.memory2}B, deterministic); quickjs artifact=${l1.engine?.artifact}, instantiate=${l1.engine?.instantiateOk}, jsRan=${l1.engine?.jsRan}`
        : (l1.isolation?.error ?? "L1 failed"),
      counts: {}, detail: l1 },
  ];

  const out = [];
  for (const r of receipts) {
    const dir = join(SPIKE, "evidence", r.id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const receipt = { ...base, ...r, badThrew: report.bad?.threw ?? null, apiSurface: report.apiSurface ?? null };
    writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
    out.push({ id: r.id, verdict: r.verdict, file });
  }
  return out;
}
