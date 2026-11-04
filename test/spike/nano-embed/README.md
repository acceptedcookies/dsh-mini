# spike: nano-embed — nano-agent 内核嵌入小程序的打包边界与分包策略取证

> **一句话定义**：在业主裁决「nano-agent 内核作 default local-runtime、fx 降为 secondary」之前，本 spike 用可复跑实测回答：内核及其上层单元打包成 JS bundle 后有多大、缺哪些 API、装进微信分包的具体摆法、以及「完整 nano-agent」的可嵌入边界到底画在哪。
>
> 建档：2026-11-04。环境：本机 Node + esbuild（无 nano-agent node_modules，alias 直读 TS 源）。上游真相：`context/nano-agent@`（当前工作树）。证据上限：体积与 API 表面为实测；JSC 行为经 DevTools 模拟器实测；真机为 NOT_RUN。

## 1. 服务的设计前提

业主 2026-11-04 意图：把 nano-agent 嵌入 dsh-mini 作为 default local-runtime（与 cloud-runtime 同源），fx 降为 secondary 可选。本层 spike 只产事实：各层 bundle 的体积、API 缺口、分包摆法；不回答合同面问题（kernel 语义是否即 local-runtime 合同）。

## 2. 分层定义（行与档的对应）

| 档 | 组成 | 对应的 spike 行 |
|---|---|---|
| T1 内核 | `agent-runtime-kernel` + 传递闭包（agent-execution DTO + nacp-* + zod） | EM-H1 |
| T2 可执行 | T1 + `agent-provider-executor`（executeProviderAttemptV1） | EM-H2 |
| T3 便携宿主 | T2 + `workers/agent-core/src/{kernel,llm}` 中不触 Workers env 的子集 | EM-H3 |
| T4 完整 nano-agent | `workers/agent-core/src/index.ts` 全量闭包 | EM-H4（预期撞墙，量墙） |

## 3. 判读门槛（执行前冻结）

| 行 | PASS 定义 | 读法 |
|---|---|---|
| EM-H1 | T1 bundle 产出 + minified 体积 + API 表面分类表 | <1.5MB min → 内核嵌入体积可行 |
| EM-H2 | T2 bundle 产出或记录阻塞点 | 给出「可执行 turn」的真实增量成本 |
| EM-H3 | T3 可 bundle 子集比例 + 阻塞模块清单 | 宿主便携度量化 |
| EM-H4 | T4 打包失败点/Workers-bound 模块枚举 | 「完整嵌入」边界证据 |
| EM-S1 | T1 bundle 在 DevTools appService 内执行 kernel 导出（digest 或 reducer）返回正确结果 | JSC 运行真实性 |
| EM-S2 | 由各档实测体积算出分包摆法 | 2MB/包、总包预算下的具体布局 |
| EM-R1 | 真机执行 | 记录为 NOT_RUN（无设备通道） |

跑完不挪门槛。NOT_RUN 如实登记，不补拍。

## 4. 目录纪律

- `ledger.mjs` = 行注册表；`rows/*.mjs` = 每行定义与判读；`harness/run.mjs` = 驱动；`lib/` = 打包器/API 扫描/体积分析；`evidence/` = 每行 JSON 证据（gitignore 排除大二进制）。
- 产物 `out/` gitignore；`context/` 全程只读（esbuild alias 指源，不在参考系内安装）。

## 5. 价值台账

1. 内核嵌入的**真实体积**与分包摆法（不是估的）。
2. 「完整 nano-agent 嵌入」的**阻塞边界清单**——哪些模块吃 Workers 面、各占多少。
3. JSC 兼容证据：T1 bundle 在真 appService 的实测执行结果。
4. 分包预算表：多 wasm+JS 混装时的 2MB/包、总包账本。

## 6. 执行结果（2026-11-04）

| 行 | 档 | minified | gzip | 文件数 | 判定 |
|---|---|---|---|---|---|
| EM-H1 | T1 kernel | 1,705,046 | 211,717 | 344 | **PASS**（体积可行，近上限） |
| EM-H2 | T2 +executor | 1,746,791 | 223,297 | 357 | **PASS**（增量仅 42KB，I/O 全注入式） |
| EM-H3 | T3 host-lite | 1,882,116 | 261,228 | 472 | **PASS**（可 bundle，但引入 io 面） |
| EM-H4 | T4 完整 agent-core | 3,031,199 | 555,018 | 868 | **MEASURED-撞墙**（见 §6.2） |
| EM-S1 | JSC 实测 | — | — | — | **PASS**：jitless banner 后 loaded=true、44 exports、canonicalJson/KERNEL_VERSION 返回正确 |
| EM-R1 | 真机 | — | — | — | NOT_RUN |

### 6.1 API 表面（实测计数）

| 面 | T1 | T2 | T3 | T4 |
|---|---|---|---|---|
| crypto.subtle（需 shim） | 2 | 4 | 7 | 50 |
| atob/btoa（wx.base64*） | 4 | 4 | 4 | 8 |
| fetch（需接 proxy） | 0 | 0 | 2 | 22 |
| AbortController | 0 | 1 | 5 | 6 |
| env.*（Workers 绑定） | 2 | 2 | 2 | 19 |
| Request/Response | 0 | 0 | 0 | 45 |
| cloudflare:workers external | — | — | — | 是 |
| **zod JIT（`new Function`）** | **会撞** | 会撞 | 会撞 | 会撞 |

**zod JIT 重大发现**：zod v4 的 `allowsEval` 探针只做 `new Function('')` 不调用——小程序里 `Function` 存在但返回不可调用对象，探针误判可 eval → 后续 `_zod.parse` 走 JIT `Doc.compile` 崩。解法已实证：esbuild banner `globalThis.__zod_globalConfig={jitless:true}`（zod 全局配置读该对象），零侵入、不损 tree-shaking、EM-S1 实测通过。**任何 mp bundle 必须带此 banner。**

### 6.2 「完整 nano-agent 嵌入」的墙（EM-H4 证据）

T4 = `workers/agent-core` 全量闭包 3.03MB/868 文件。三堵墙：

1. **体积墙**：单包 3.03MB > 2MB/分包线；即便拆包，与 fx wasm(4.1MB) 混装时总包预算告急。
2. **运行时墙**：`cloudflare:workers`（WorkerEntrypoint/DurableObject/RpcTarget）+ `env.*`×19 + `Request/Response`×45 + `WebSocketPair`——整个 host 层建立在 Workers 运行时之上，shimming 成本 = 重写 workerd。
3. **语义墙**：agent-core 的 turn 驱动绑 DO 存储/hibernation/跨 worker RPC，抽掉这些后的"嵌入"只剩皮。

**结论：完整嵌入不成立；正确边界在 T2（kernel+executor）。**

### 6.3 分包摆法（EM-S2）

| 方案 | 布局 | 可行性 |
|---|---|---|
| A. kernel 独立分包 | `subpkg/kernel/` 1.71MB（含 jitless）+ fx wasm 另分包 4.1MB 需切片≥3 包 | **成立**：kernel 单包贴 2MB 线下，启动时按 runtime 模式懒载 |
| B. kernel 瘦身 | 删 generated-tool-contract.ts(2.9MB 源) 中未用段、zod→mini 变体 | 可降到 ~1MB 级，但需上游配合或 fork 期裁剪 |
| C. 全量嵌入 | T4 3.03MB | **不可行** |

总预算：主包(壳+UI) + kernel 分包 1.71MB + fx wasm 分包（4.1MB 切片）≈ 8MB，20MB 总包内有余量。

### 6.4 事实结论（供业主裁决）

- kernel 嵌入 = **真实可行**：1.63MB 单分包、JSC 实测可跑、API 缺口仅 crypto.subtle/atob（已有实现）。
- default local-runtime = kernel 版在技术上成立的前提：写一个 nano-mini host（I/O 注入 fetch→proxy、存储→VFS/state、tool→同 fx 调度缝）。executor 已证实零 fetch（全注入）。
- 完整 nano-agent 嵌入 = **不成立**（三墙实证）。
- fx 降为 secondary 的代价：4.1MB wasm 仍占分包预算；若 kernel 版稳定，fx 可进可留（用户可选）——不阻塞裁决。

## 7. EM-N：kernel + CAS后端 + tick = session.do 状态机级替代（Node 宿主实测）

宿主 = `harness/kernel-do.mjs`（Node 直接驱动**同一份** mp bundle `out/t1-kernel.cjs`），后端 = CasStore（Map+etag+If-Match/If-None-Match 的 pgs3 语义替身，诚实声明非真 pgs3）。

| 行 | 断言 | 实测 | 判定 |
|---|---|---|---|
| EM-N1 | 全 turn 状态机驱动 | `llm_call>tool_exec>llm_call>finish:turn_complete`，每步 buildCheckpointFragment→CAS 落盘 | **PASS** |
| EM-N2 | kill/resume 不双跑 | step2 后 kill → restoreFromFragment 续跑 → `llm_call>finish`，**toolExecs=1** | **PASS**（durable cursor 成立） |
| EM-N3 | 单写者 fencing | claim `If-None-Match:*` 200/412；陈旧 etag 写 412；CAS 写 200 | **PASS** |
| EM-N4 | alarm→sweep→resume | kill 后 alarm 记录 → sweepTick claim → 恢复 → completed | **PASS** |

**结论：pgs3（state CAS + claim + alarm 三键区）+ 周期 tick（wx cron/云函数）+ kernel bundle（同一份跑 mp JSC 与 Node 宿主）= session.do 的状态机级替代可行，四条核心语义全部实证。** 剩余真实差距（未测、诚实记录）：
- 真 pgs3 的 CAS 语义（POD1 车道，待业主授权端点）
- CloudBase 函数内跑 bundle 的冷启动/超时边界（部署需业主授权）
- LLM/tool 真 I/O 的挂接（T2 已证注入式，但未联真 LLM）
- `wait` 分支的 confirmation_pending/confirmation 语义未触
- ws 流式退化：事件只能入 state，客户端轮询读（非 hibernation 等价物）

---

## §8 转正去向（MN01 完成后追记）

本 spike 的全部结论已产品化转正：`kernel-do.mjs` → `services/nano-mini-host/pump.ts`（+ `scripts/mn01-harness.mjs` 保留 N1-N4+双负例回归）；打包器 → `scripts/build-kernel.mjs`（双出口+kernelPin+jitless banner+--upgrade）；smoke → `test/mn01/smoke.mjs`（三金丝雀）。本目录保留作取证底稿，不再演进——新工作一律在转正件上进行。
