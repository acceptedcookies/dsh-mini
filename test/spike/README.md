# test/spike — 设计前真实语义取证工作区

> **一句话定义**：spike 是**设计功能之前**的前期测试与证据搜集。它用可复跑的实测，回答「这个设计前提在真实运行时、真实打包产物、真实设备上是否成立」。**spike 只产事实，不产合同。**

`test/spike/` 不是测试层：不进 CI（本仓库当前无 CI），不占包体预算，不是任何阶段的收口指标。产品代码的验证仍以 `npm run typecheck` 与微信开发者工具编译为准。

组织先例：`context/nano-agent/test/spike/`（neo 分支）的宪章制工作区；纪律同源改写。

---

## 1. 现有工作区

| 目录 | 服务的设计 | 环境 | 状态 |
|---|---|---|---|
| `fx-wasm-jspi/` | fx WASM 核作为免登录内置 runtime：挂起机制（JSPI / Asyncify）在微信 JS 引擎上是否成立 | 本机 Node · DevTools 模拟器 · 真机 | 已执行（2026-11-03）：H/S 6/6 行跑毕，R×2 NOT_RUN；JSPI 缺席、Asyncify S1 级成立 |
| `fx-wasm-size/` | 同上：`fx-core.wasm` 能否压进 2MB 分包上限 + 渐进热载/拆分清单 | 本机 Node + zig 0.17 源码构建 | 已执行（2026-11-03）：8/8 PASS；**超线 7.8%，单 wasm 高危**；wasi_fs 为最大可裁族（incl 1.16MB）；pkg0/1/2 清单与拆分顺序见 §6 |
| `fx-wasm-stream/` | 同上：`wx.request` 分块传输能否承载 OpenAI 兼容 SSE 流式 + magpie live-local 端点语义 | 本机 Node · 本机 live 网关 · DevTools 模拟器 · 真机 | 已执行（2026-11-03）：H/S 6/6 PASS（含 live-local ST-H4），R×2 NOT_RUN；分块/增量/abort S1 级成立 |
| `fx-wasm-agent/` | 同上（端到端）：真实 fx-core.wasm（asyncify 编译）在 `WXWebAssembly` 内完成真实 ACP 会话 + LLM turn + tool-call 循环 + 真实分包加载 | 本机 Node + magpie · DevTools 模拟器 + magpie · 真机 | 已执行（2026-11-03）：4/6 PASS（H1 双段 turn、S1 文本 turn、S2 tool-call 循环、S3 分包实例化），R×2 NOT_RUN；**asyncify 使 wasm 膨胀至 4.1MB（+55.7%），2MB 分包线对 asyncify 产物仍超线** |

每个工作区的方法、判读门槛和结论以其自己的 `README.md` 为准。

### 1.1 共同服务的设计前提

[业主] 2026-11-03 意图：nano-agent 作远端 agent-runtime（已登录经 nano-platform）；fx 经 WASM 分包加载，作未登录时小程序内置的默认 agent-runtime；用户自填 provider endpoint，LLM 循环在小程序内直连完成。本层 spike 回答该前提的运行时可行性，**不回答**合同面问题（provider 白名单策略、Responses vs Chat Completions、内置工具集、BYOK key 是否经中转）——那些是 [业主] 裁决项，spike 只把事实补齐。

---

## 2. 目录纪律

1. **一个 spike 一个目录**，用 feature 名命名（`fx-wasm-jspi`），不用阶段前缀。`test/spike/` 根下只放本 README 和工作区目录。
2. **宪章 README 先行**：一句话定义、锚表（建档日期、HEAD、上游真相、环境、证据上限、组织先例）、边界声明、价值台账、判读门槛。**判读门槛在执行前写死，跑完不挪。**
3. **只产证据**：不改公共合同，不改冻结真相，不在 spike 工作区里施工产品代码。结论要转正，走 [业主] 决定并 durable 登记（`AGENTS.md` §0 [不得擅自扩约]）。spike 探针一律放独立工程，**不混入产品小程序包**（工作区 `mp/` 自带 `project.config.json` + `app.json`；本机 DevTools 登录态下 `touristappid` 不可用，S 车道实测用产品 AppID `wx356d3abb52825466`，仅作模拟器探针工程，不产生发布物）。
4. **证据分级诚实**：结论写明环境与等级（见 §3），模拟器 PASS 不写成真机 PASS，本机 PASS 不写成设备 PASS。终态词用 `PASS` / `RED` / `NOT_RUN`（附原因）/ `deferred`（附前置）。first-red 是合法终态，补测另写新 receipt，不覆盖先红的那份。
5. **证伪镜像（plants）**：凡是「探测某能力存在与否」的行，必须带至少一枚反例镜像——植入后断言必须变红、复原必须变绿，证明探针不是恒绿。镜像计入行的 `plants` 字段。
6. **预算先行**：每行带 `objects` / `opsCap` / `bytesCap` / `stopCondition`；禁止定时器自唤醒、循环重试、后台预热。真实 provider 调用一律 `NOT_RUN`，除非 [业主] 提供 endpoint + key 并点收。
7. **真值先行**：断言只认探针实测返回的字节/布尔/字节数，不认文档描述；SSE 行认「逐 chunk 独立到达的实测计数」，不认「请求成功」。
8. **可抛弃**：durable 的只有 README 里的方法、判读门槛与结论回填；receipt、evidence、生成物按工作区 `.gitignore` 忽略。结论被 [业主] 登记后，工作区可整体删除。
9. **环境与费用**：全离线行优先；本机 mock 端点零费用；任何真实 provider / live 网络调用需 [业主] 明确授权并提供凭证。

---

## 3. 环境分级

| 级 | 含义 | 载体 |
|---|---|---|
| `H1` | 本机 macOS Node 22，离线 | `rows/*.mjs` 直跑；wasm 构建/变换/测量、协议解析对照臂 |
| `S1` | 微信开发者工具模拟器 | `miniprogram-automator` 驱动 spike 工程（`mp/`），页面内 `WXWebAssembly` / `wx.request` 实测，结果经 automator 抓回 |
| `R1` | 真机 iOS（微信内预览/真机调试） | 同一 spike 工程，结果由页面 POST 回本机收集端，或人工抄录入 receipt |
| `R2` | 真机 Android | 同上 |

**模拟器与真机分开判读**：JS 引擎不同源（DevTools V8 ≠ 设备 WKWebView/JSC 或厂商 V8），`S1 PASS` 对 `R1`/`R2` 只作参考，不作覆盖。

补充 envClass `host-local-live`（2026-11-03 起）：经 [业主] 登记的本机 live 端点（magpie 网关，`.local.development.json`）。证据含义 = 真实协议面 + 真实模型路由，但绑本机回环与具体路由配置，**不外推**为任意公网 provider 或真机证据；preflight 先行探活，端点缺席即 `NOT_RUN`。

补充 envClass `devtools-sim-live`（2026-11-03 起，fx-wasm-agent 用）：DevTools 模拟器内运行 + 本机 live 端点可达双门。证据含义 = 模拟器级端到端（真实 wasm+真实协议+真实模型），**仍不覆盖**真机 JS 引擎差异与真机网络路径。

---

## 4. 证据信封（receipt）

```text
id, lane, verdict, reason, envClass(host-node|host-local-live|devtools-sim|ios|android), grade(H1|S1|R1|R2), at,
headSha, dirtyWorktree,
device{model, osVersion, wechatVersion, baseLibVersion, sdkVersion}|null,
counts{...}, timing{diagnostic:true, samples, p50, p95, unit}|null,
plants[{id, fired, restored}] ,
budget{objects, opsCap, bytesCap, stopCondition, used},
remoteOps, detail
```

- 行 receipt：`test/spike/<name>/evidence/<id 小写>/<UTC 时间戳>.json`，由工作区 `.gitignore` 忽略。
- 凭据、token、prompt 正文不进 receipt；只记布尔、计数、sha256、字节数、毫秒。

---

## 5. 通用文件拓扑

```text
test/spike/<name>/
├─ README.md        宪章（锚表 / 价值台账 / 判读门槛 / 镜像 / 收口回填）
├─ .gitignore       evidence/ 与 node_modules 等可重跑产物
├─ ledger.mjs       全部行：id / 车道 / 价值 / 判据 / 镜像 / 预算 / 前置
├─ harness/run.mjs  --plan | --check | <行号> [--record]
├─ lib/             preflight / envelope / versions / 车道驱动
├─ ref/             对照臂（与被测路径分开实现的比较器/参考实现）
├─ fixtures/        确定性种子语料与镜像索引
├─ rows/            一行一文件
├─ mp/              （仅设备级行）独立 spike 小程序工程
└─ evidence/        per-run receipt（gitignore）
```
