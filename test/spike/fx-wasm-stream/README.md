# test/spike/fx-wasm-stream — wx.request 分块传输承载 SSE 流式的取证宪章

> **一句话定义**：回答「`wx.request({enableChunked:true})` + `onChunkReceived` 能否在小程序内承载 OpenAI 兼容 SSE 流（BYOK 直连模型所必需）」，含流完整性、逐 chunk 独立到达、中途 abort 三个子问题。本目录只产证据，不改公共合同，不施工产品代码。

| 锚 | 值 |
|---|---|
| 建档日期 | 2026-11-03 |
| HEAD | `9ee4c28` |
| 上游真相 | 微信小程序文档 `wx.request`（`enableChunked` + `RequestTask.onChunkReceived`，ArrayBuffer 分块到达）；fx/libfx 侧需求：`sdk/engine.js` 的流事件（`text_delta` 等）依赖网关 SSE；`context/fx/src/gateway/sse.zig`（fx 的 SSE 协议面） |
| 组织先例 | `context/nano-agent/test/spike/`；dsh-mini `test/spike/README.md` |
| 环境 | 本机 Node（H1 对照臂与 mock）；DevTools 模拟器（S1，automator 驱动，`urlCheck=false` 允许 http://127.0.0.1 mock）；真机 iOS/Android（R1/R2，需 [业主] 设备 + LAN mock 或自有端点） |
| 证据上限 | mock 端点是本机 Node http server，0 费用、0 外部依赖；真实 provider 行需 [业主] 提供 endpoint+key，否则 `NOT_RUN`；S1 结论不覆盖真机 |

**边界声明**：不改产品代码；spike 工程用 `touristappid`；mock 只绑 127.0.0.1，不接受外部连接（R 车道如需 LAN，由 [业主] 另行点收并改用机器 LAN IP，receipt 记 `bind` 事实）；不产生 provider 调用；结论被登记后可整体删除。

---

## §0 代码现实初步分析

- `onChunkReceived` 的语义是「底层数据块到达」，**不保证**每块对应一个 SSE event：TCP 分段/缓冲可把多个 event 并入一块，也可把一个 event 切到两块。因此判据必须以「增量解析出的事件序列」为准，而不是 chunk 数本身——但「chunk 独立到达 ≥2 次」是流式（非一次性缓冲送达）的必要证据，两者都记。
- `responseType` 对 chunk 的影响：chunk 以 ArrayBuffer 到达；语料用 ASCII，手工解码，绕开 TextDecoder 是否存在的未证项。
- DevTools 的 `urlCheck=false` 只对开发态生效；正式版域名白名单是合同面，spike 不管。

### 0.5 发现台账

| ID | 发现 | 处置 |
|---|---|---|
| （执行后回填） | | |

---

## §1 本目录回答什么

1. 增量 SSE 解析器在任意分块边界下与整包解析**逐事件一致**（协议正确性，对照臂先行）。
2. `wx.request` chunked 模式在 DevTools 模拟器内能否：连接 127.0.0.1 mock、≥2 次独立 `onChunkReceived` 触发、解析出完整且顺序正确的 OpenAI 风格事件流。
3. `RequestTask.abort()` 中途终止是否干净（不再收到 chunk、无未捕获异常、任务可弃）。
4. 以上在真机 iOS/Android 是否同样成立（R 车道）。
5. 业主登记的 magpie 本机网关（`.local.development.json`，`api_type=responses`）作为 **live-local 真实端点**的 Responses API 语义：模型清单、非流式应答、`function_call` 工具调用、canonical SSE 事件序列。

不回答：任意公网 provider 的 TLS/证书链/域名白名单表现（合同面与凭证面，需 [业主] 裁决）；`wx.connectSocket` 替代路径；长会话内存占用；magpie 网关的非 grok 路由与计费语义。

---

## §2 价值台账（`V-T*`）

| ID | 待证价值 | 判据（写死） | 承接行 |
|---|---|---|---|
| `V-T1` | 增量解析正确性：任意重分块后事件序列与整包解析全等 | 种子化边界枚举全部一致 | ST-H2 |
| `V-T2` | Node 对照臂：mock → fetch 可读流，≥2 次 read、事件全等 | read 次数 ≥2 且事件序列等于语料 | ST-H1 |
| `V-T3` | DevTools：wx.request chunked 承载完整 SSE 流 | `chunks ≥ 2` ∧ `events == corpus` ∧ 无解析错 | ST-S1 |
| `V-T4` | DevTools：abort 干净 | abort 后 ≥800ms 无新 chunk、无异常、task settled | ST-S2 |
| `V-T5` | 真机：V-T3/V-T4 等价断言 | 同判据，设备信息入 receipt | ST-R1、ST-R2 |
| `V-T6` | magpie live-local Responses 端点：清单/非流式/tool call/流式全通 | 模型在列 + `status=completed` + `function_call` 有 `call_id` + `response.created`→`response.completed` 事件序 | ST-H4 |

**收口判断**：`V-T1`∧`V-T2` 是协议前提（必须 PASS，否则修解析器再测）；`V-T3`∧`V-T4` PASS → 「wx.request 承载流式」成立（S1 级）；R 行缺席 → 标 S1 级。

---

## §3 测试方法

### 3.1 终态与分级

`PASS` / `RED` / `NOT_RUN` / `deferred`；分级 H1 / S1 / R1 / R2（总 README §3）。

### 3.2 行与车道

| 车道 | 行 | 执行体 |
|---|---|---|
| host | ST-H1/H2/H3 | Node：mock server + fetch 对照 + 解析器边界枚举 + 镜像 |
| host-local-live | ST-H4 | Node：`.local.development.json` 登记的 magpie 网关真实请求（[业主] 2026-11-03 授权；`remoteOps=4`） |
| sim | ST-S1/S2 | automator 拉起 `mp/`，页面内 `wx.request` 连本机 mock |
| device | ST-R1/R2 | 同工程真机预览；结果 `SPIKE_RESULT_JSON` 抄回 |

### 3.3 mock 契约（lib/sse-server.mjs）

`GET /sse`：分 `N=8` 次 flush OpenAI 风格 `data:` 帧（间隔 40ms，强制独立到达）+ `data: [DONE]`，ASCII，每帧 `{"id":"spike","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"delta-N …"}}]}`；`?flush=single` 一次吐全量（镜像）；`?delay=0` 无间隔。语料由 `fixtures/corpus.mjs` 确定性生成，三方（mock / Node 解析 / mp 解析）同源比对。

### 3.4 证伪镜像

| ID | 植入 | 预期 |
|---|---|---|
| `P-sse-single` | mock `flush=single` 全量一次送达 | 以「chunks ≥2」为判据的行必须 RED——证明计的是块到达而非字节 |
| `P-sse-split` | 语料在 SSE `data:` 行中间被 TCP 切断（`?split=1`，帧内再分两 flush） | 增量解析仍须全等——证明判据是事件层而非 chunk 层 |

### 3.5 预算

`objects ≤ 4`（mock 进程内）、`opsCap ≤ 60`、`bytesCap ≤ 4 MiB`、`stopCondition: first RED`；automator 60s，探针 30s；`remoteOps = 0`（ST-H4 例外：`remoteOps = 4`，live-local 授权端点）。

### 3.6 设备行证据通道

`SPIKE_RESULT_JSON` = 页面 probe 结果 JSON 落盘路径（设备侧页面把结果 JSON 复制出来或 POST 到 spike 收集端——本宪章期只定义文件通道）；`SPIKE_DEVICE_*` 记设备事实。设备侧 mock 用 LAN IP 时需 [业主] 点收（§边界声明）。

---

## §4 文件拓扑

```text
test/spike/fx-wasm-stream/
├─ README.md                 本宪章
├─ .gitignore                evidence/
├─ ledger.mjs                ST-* 行契约
├─ harness/run.mjs           --plan | --check | <行号> | --all
├─ lib/preflight.mjs         环境门（host/sim/device）
├─ lib/envelope.mjs          receipt 信封
├─ lib/versions.mjs          版本钉
├─ lib/sse-server.mjs        mock OpenAI SSE 端点（127.0.0.1 only）
├─ lib/sse-parser.mjs        增量 SSE 解析器（对照实现 A）
├─ lib/automator.mjs         miniprogram-automator 封装
├─ ref/sse-whole.mjs         整包解析器（对照实现 B，与 lib 分开写）
├─ fixtures/corpus.mjs       确定性语料生成器（三方同源）
├─ rows/st-h1.mjs            Node fetch 对照臂（V-T2）
├─ rows/st-h2.mjs            解析器边界枚举（V-T1）
├─ rows/st-h3.mjs            P-sse-single + P-sse-split 镜像
├─ rows/st-h4.mjs            magpie live-local Responses 端点实测（V-T6）
├─ rows/st-s1.mjs            DevTools wx.request chunked（V-T3）
├─ rows/st-s2.mjs            DevTools abort 干净（V-T4）
├─ rows/st-r1.mjs            iOS 真机（V-T5）
├─ rows/st-r2.mjs            Android 真机（V-T5）
├─ mp/                       独立 spike 小程序工程（touristappid, urlCheck=false）
│  ├─ project.config.json
│  ├─ app.json / app.js      globalData { targetUrl, probeResult }
│  ├─ pages/index/*          探针页 + 手动输入 URL 的设备入口
│  ├─ probe/stream-probe.js  wx.request chunked 探针（含 abort 臂）
│  └─ probe/sse-parser.js    增量解析器（与 lib 实现同步的注释副本）
└─ evidence/                 per-run receipt（gitignore）
```

---

## §5 行台账

| ID | 名称 | 车道 | 价值 | 级 | 前置 |
|---|---|---|---|---|---|
| `ST-H1` | Node fetch 对照臂 | H | V-T2 | H1 | — |
| `ST-H2` | 解析器边界枚举 | H | V-T1 | H1 | — |
| `ST-H3` | 镜像行（single/split） | H | — | H1 | `ST-H1` `ST-H2` |
| `ST-H4` | magpie live-local 端点实测 | H | V-T6 | H1 | `.local.development.json` 已登记（缺失记 NOT_RUN） |
| `ST-S1` | DevTools chunked 承载 | S | V-T3 | S1 | `ST-H1` |
| `ST-S2` | DevTools abort 干净 | S | V-T4 | S1 | `ST-S1` |
| `ST-R1` | iOS 真机 | R | V-T5 | R1 | `ST-S2`；`D-1` |
| `ST-R2` | Android 真机 | R | V-T5 | R2 | `ST-S2`；`D-2` |

`D-1`/`D-2` = [业主] 真机与 LAN mock 点收，未点收即 `NOT_RUN`。

## §6 收口回填

执行日期 2026-11-03，HEAD `9ee4c28`。设备指纹（S1）：DevTools 模拟器 iPhone 17 / WeChat 8.0.5 / baseLib 3.17.5。

| 行 | 终态 | 级 | 结论摘要 |
|---|---|---|---|
| ST-H1 | PASS | H1 | Node fetch 对照臂：≥2 次独立 chunk 到达，增量解析 == 整包解析 == 语料 |
| ST-H2 | PASS | H1 | 6 种重切块枚举全部产出相同事件序列（9 events），解析器对块边界免疫 |
| ST-H3 | PASS | H1 | 镜像验证：单次 flush 触发 chunk 专属门；帧中切割在事件层保持正确 |
| ST-H4 | PASS | H1 | **live magpie（`cursor/grok-4.7@500k`）全通**：模型在列；非流式 `completed`+"ok"；`function_call` 带 `call_id`+解析参数；流式 25 事件 canonical 序（created→completed），13879ms/4252ms |
| ST-S1 | PASS | S1 | **`wx.request({enableChunked:true})` 在模拟器内 ≥2 独立 chunk 承载完整 SSE 语料** |
| ST-S2 | PASS | S1 | `abort()` 干净终止：800ms settle 窗内 abort 后 0 chunk |
| ST-R1 | NOT_RUN | R1 | 无 [业主] 授权真机（gate D-1） |
| ST-R2 | NOT_RUN | R2 | 同上（gate D-2） |

### 发现台账

1. **SSE 承载在 S1 级成立**：`onChunkReceived` 逐块到达 + 增量解析 + 干净 abort，OpenAI 兼容流式协议的传输前提在模拟器成立。BYOK 直连的传输面没有阻塞项（合法域名白名单仍是 [业主] 裁决项，见根 README §1.1）。
2. **增量解析与块边界无关**：任意重切块（含帧中切割）事件序列一致——宿主无需对齐 chunk 边界。
3. **证据上限**：真机弱网/锁屏行为未证（R1/R2 NOT_RUN）。
4. **live-local 证据入账（V-T6）**：业主登记的 magpie 网关 = 真 Responses API 端点 —— `/v1/models` 25 模型（auto/cursor/devin/workbuddy 路由组）；`/v1/responses` 非流式+流式+`function_call` 全部 canonical；免 key（本机回环）。**含义**：fx-wasm 的 BYOK 面有了真实 Responses 协议对照物，`api_type=responses` 的端点形态实测成立 —— 但证据类为 `host-local-live`，不外推为任意公网 provider。
