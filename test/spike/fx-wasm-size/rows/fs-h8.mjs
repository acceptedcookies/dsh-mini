// FS-H8 — 渐进热载顺序 + wasm 拆分清单 (V-S8)
// 消费 FS-H1(基准/节区) 与 FS-H6(import 族归属) 的最新 receipt,
// 产出 fixtures/package-manifest.json: 首包/次包/可选包的内容清单、
// 归属字节预算、加载顺序与拆分顺序。字节数字标注为归属下界, 不冒充可运行拆分。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUBPACKAGE_LIMIT } from "../ledger.mjs";

function latestReceipt(spikeDir, rowId) {
  const dir = join(spikeDir, "evidence", rowId.toLowerCase());
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
}

export async function run(ctx) {
  const { spikeDir } = ctx;
  const h1 = latestReceipt(spikeDir, "FS-H1");
  const h6 = latestReceipt(spikeDir, "FS-H6");
  if (!h1 || !h6) {
    return {
      verdict: "NOT_RUN",
      reason: "needs FS-H1 and FS-H6 receipts — run them first",
      counts: {},
    };
  }

  const c = h6.counts;
  const num = (k) => c[k] ?? 0;
  const inclusive = (f) => num(`incl_${f}`);
  const exclusive = (f) => num(`excl_${f}`);

  // 包划分依据: 首包 = 无 import 可达的引擎核 + LLM 传输边界 (http) —
  // 「能发出第一个请求并流回第一个 token」的最小集; 次包 = 会话持久化与
  // 宿主工具桥 (一轮完整 turn); 可选包 = 小程序无 POSIX 语义的 wasi_fs
  // 能力族 (最大可裁候选) + oauth/attachment。
  const manifest = {
    artifact: { baselineBytes: h1.counts.baselineBytes ?? h1.counts.bytes, limit: SUBPACKAGE_LIMIT },
    note:
      "attributedBytes are call-graph lower bounds (direct calls only; " +
      `${c.callIndirectSites} call_indirect sites untracked). A runnable ` +
      "split needs source-level gating or wasm-split — not measured here.",
    packages: [
      {
        id: "pkg0-first-token",
        name: "首包 — 引擎核 + LLM 传输",
        families: ["engine-core(no import reach)", "http"],
        attributedBytes: num("engineUnattributedBytes") + inclusive("http"),
        contains: [
          "agent loop / prompt 组装 / 协议解析 (import-unattributed)",
          "fx_http_request + fx_http_stream_* (SSE 出口边界)",
          "_start 与运行时启动",
        ],
        deferredFamilies: ["session", "journal", "steering", "host_tool", "oauth", "attachment", "wasi_*"],
      },
      {
        id: "pkg1-turn-machinery",
        name: "次包 — 会话与工具桥",
        families: ["session", "journal", "steering", "host_tool"],
        attributedBytes:
          inclusive("session") + inclusive("journal") + inclusive("steering") + inclusive("host_tool"),
        contains: [
          "fx_session_load/commit + list/remove (会话持久化)",
          "fx_journal_flush (事件日志)",
          "fx_steering_* (中断/接管)",
          "fx_host_tool_call + result read/release (小程序宿主工具桥)",
        ],
      },
      {
        id: "pkg2-optional-capabilities",
        name: "可选包 — 无小程序语义的能力族",
        families: ["wasi_fs", "wasi_other", "oauth", "attachment"],
        attributedBytes:
          inclusive("wasi_fs") + inclusive("wasi_other") + inclusive("oauth") + inclusive("attachment"),
        contains: [
          "fd_*/path_* WASI 文件系统面 (小程序无 POSIX fs — 最大可裁族)",
          "args/environ/clock/random/proc_exit (可宿主垫片)",
          "fx_oauth_session_* (ChatGPT/Grok 订阅登录 — BYOK 场景可整族裁)",
          "fx_attachment_* (图片附件 — 可选)",
        ],
      },
    ],
    sharedPool: {
      multiFamilyBytes: num("sharedMultiFamilyBytes"),
      note: "reaches >=2 families — cannot be cleanly assigned; a real split must decide ownership",
    },
    loadOrder: ["pkg0-first-token", "pkg1-turn-machinery", "pkg2-optional-capabilities"],
    splitOrder: [
      "step1: WASI fs 族整族源码级 gate — 无 POSIX 的宿主上 fd/path 调用本应编译期消去",
      "step2: oauth/attachment 宿主边界整族 gate",
      "step3: 若仍超线, session/journal 与 engine 间打 wasm-split 边界",
    ],
    honestLimits: [
      "pkg0 attributedBytes 是「无 import 可达函数 + http 独占」下界, 不是可链接产物",
      "multiFamily 共享池未分配 — 真实拆分必须决定归属, 归属不同包结果不同",
      "builtin_tools 翻转零增量 (FS-H7): 工具面不是体积杠杆",
    ],
  };

  const manifestPath = join(spikeDir, "fixtures", "package-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const pkg0 = manifest.packages[0].attributedBytes;
  const checks = [
    pkg0 > 0 && pkg0 < c.totalCode,
    exclusive("wasi_fs") >= 0,
    manifest.packages.every((p) => p.attributedBytes >= 0),
  ];
  return {
    verdict: checks.every(Boolean) ? "PASS" : "RED",
    reason:
      `manifest written: pkg0≈${pkg0}B(engine+http 下界), ` +
      `pkg1≈${manifest.packages[1].attributedBytes}B, ` +
      `pkg2≈${manifest.packages[2].attributedBytes}B, shared pool ${num("sharedMultiFamilyBytes")}B — ` +
      `largest optional family wasi_fs inclusive ${inclusive("wasi_fs")}B`,
    counts: {
      pkg0Attributed: pkg0,
      pkg1Attributed: manifest.packages[1].attributedBytes,
      pkg2Attributed: manifest.packages[2].attributedBytes,
      sharedPoolBytes: num("sharedMultiFamilyBytes"),
      wasiFsInclusive: inclusive("wasi_fs"),
      wasiFsExclusive: exclusive("wasi_fs"),
      httpExclusive: exclusive("http"),
    },
    remoteOps: 0,
    detail: { manifestPath, packages: manifest.packages.map((p) => p.id) },
  };
}
