# spike: fx-wasm-agent — 真实 fx-core.wasm agent loop 在小程序内

> spike 是一次取证，不是合同。本目录把「dsh-mini 免登录默认 runtime = 分包加载的 fx wasm」
> 从「toy wasm + mock SSE」升级为「真实 fx-core.wasm（asyncify 编译）+ 真实 ACP 会话 +
> 真实 LLM（magpie 网关）+ 真实 tool-call 循环 + 真实分包加载」的端到端实测。

## §1 锚表

| 项 | 值 |
|---|---|
| 建档日期 | 2026-11-03 |
| 被测物 | `fixtures/fx-core-async.wasm` = `zig build -Dwasm-surface=core`（raw 2,632,761B）→ `wasm-opt --asyncify --pass-arg=asyncify-imports@<22个挂起import> -Oz`（4,098,991B，feature 集不含 all-features，否则 import kind 0x7e 非法） |
| 上游 | `context/fx`（HEAD f72875054 同系）；宿主层移植自 `sdk/wasm-runtime.js`（JSPI→asyncify 改写） |
| LLM 端点 | `.local.development.json` → magpie `http://127.0.0.1:3425`，custom provider 协议 `openai-chat-completions`（fx `configured_provider.zig` 唯一支持协议；`responses` 会 `InvalidProtocol`） |
| 环境 | Node 22（H1）；微信 DevTools 模拟器 iPhone / WeChat 8.0.5 / baseLib 3.17.5（S1） |
| 证据上限 | S1 ≠ 真机；`devtools-sim-live` 不外推公网 provider；4MB 分包仅在模拟器编译链实测，上传/真机包限未证 |

## §2 判读门槛（执行前写死，跑完不挪）

| 终态 | 含义 |
|---|---|
| PASS | 真实 turn 完整走通：ACP initialize→libfx/new→session/prompt→stopReason=end_turn，且断言全部成立 |
| RED | 任一断言不成立 / 实例化失败 / 探针未回报 |
| NOT_RUN | 前置门缺席（真机/端点） |
| deferred | 业主门禁行（D-1/D-2 真机） |

## §3 环境类

| envClass | 含义 |
|---|---|
| `host-local-live` | Node 宿主 + magpie 本机活端点（先探活再跑） |
| `devtools-sim-live` | DevTools 模拟器 + magpie 本机活端点双门 |
| `devtools-sim` | DevTools 模拟器，无网络断言（纯实例化） |
| `ios` / `android` | 真机，需 `SPIKE_DEVICE_*` 门禁变量 |

## §4 文件视图

```
fx-wasm-agent/
├── README.md               本宪章
├── ledger.mjs              行执行契约（6 行）
├── harness/run.mjs         行驱动（plan/check/单行/all）
├── lib/
│   ├── fx-host.mjs         宿主运行时（wasm-runtime.js 移植：asyncify 驱动 + WASI/fx 全 import 面）
│   ├── acp.mjs             最小 ACP+libfx 客户端（initialize/libfx/new/session/prompt + 请求应答）
│   ├── env/                （mp 侧见 mp/fx/env.js）
│   ├── sim.mjs             模拟器驱动共享层
│   ├── automator.mjs       miniprogram-automator 启动/抓取
│   ├── preflight.mjs       envClass 门
│   ├── envelope.mjs        receipt 信封
│   └── versions.mjs        版本钉
├── rows/ag-{h1,s1,s2,s3,r1,r2}.mjs
├── fixtures/
│   ├── fx-core-raw.wasm    zig 构建原始产物 2.63MB
│   └── fx-core-async.wasm  asyncify+Oz 产物 4.10MB
├── mp/                     spike 小程序工程（独立 app.json，不占产品包）
│   ├── subpkg/fx-core-async.wasm   3.9MB 分包
│   ├── fx/{fx-host,acp,env,config}.js   lib 的 mp 拷贝 + WX 适配
│   └── pages/index/        UI：input + 发送 + 流式输出 + 日志
└── evidence/               receipts（gitignored）
```

## §5 行台账

| 行 | 车道 | 判据 | 实测 |
|---|---|---|---|
| AG-H1 | host | 两段真实 turn：纯文本（text≈"ok"）+ tool-call（get_weather fixture "22°C sunny" 进答案）；`fx_host_tool_call` 挂起 import 路径执行 ≥1 次；sessionId 合法 | PASS（5744ms/8960ms） |
| AG-S1 | sim | 模拟器内同一文本 turn，路径 `subpkg/fx-core-async.wasm` | PASS（8 updates, text="ok"） |
| AG-S2 | sim | 模拟器内 tool-call 循环：toolCall.input.city==Tokyo 且 fixture 值进最终文本 | PASS（24 updates, "**Tokyo:** 22°C and sunny."） |
| AG-S3 | sim | 仅实例化：分包路径加载 → `_start`+5 个 asyncify 导出在位 + `memory.grow(1)` 生效 | PASS（instantiate ~1s） |
| AG-R1/R2 | device | 真机 iOS/Android 各一次真实 turn | NOT_RUN（D-1/D-2 未点收） |

价值台账：V-A1=asyncify 驱动真实 fx 模块成立；V-A2=tool-call 宿主循环成立；V-A3=WXWebAssembly+wx.request 跑通 ACP；V-A4=模拟器内工具回环；V-A5=3.9MB 分包加载实例化成立；V-A6=真机（未证）。

## §6 收口结论（回填）

1. **asyncify 编译链对真实 fx-core 成立**：`wasm-opt --asyncify -Oz` 产物在 Node 与 WXWebAssembly 双双跑通完整 agent turn —— 挂起点在 fd_read/fd_write/poll_oneoff/fx_http_*/fx_host_tool_call。
2. **体积事实修正（对 fx-wasm-size 收口的重要更新）**：asyncify 插桩使 2.63MB raw → **4,098,991B（+55.7%）**，受限 `asyncify-imports` 只省 ~34KB（_start 全图可达挂起 import）。**pkg0 864KB 估算作废** —— 首包 wasm 要么接受 ~4MB（超 2MB 包限），要么走源码级 feature-gate 砍代码段（wasi_fs 1.16MB 最大）后再 asyncify。
3. **分包机制本身成立（模拟器）**：DevTools 编译链**接受了 3.9MB 分包**且 `WXWebAssembly.instantiate("subpkg/...")` 加载实例化成功 —— 2MB 包限在本地编译未拦截；上传/真机是否拦截未证，记为合同外待验项。
4. **BYOK 协议事实**：fx custom provider 唯一协议 `openai-chat-completions`；magpie `/v1/chat/completions` 兼容面完整承载流式+tool_calls。Responses 直连仍需 Zig 侧接 `responses_protocol`（业主决策项，现状可用兼容面开发）。
5. **宿主层结论**：`lib/fx-host.mjs`（~300 行）+ `mp/fx/env.js`（~90 行）证明 WX 侧只需要 `WXWebAssembly + wx.request(enableChunked) + UTF-8/随机数兜底` 即可承载全部 55 个 import —— 这即 `services/fx/` 的原型。

## §7 边界声明

- 不证真机（iOS JSC 的 WXWebAssembly 能力/性能未证，4MB 模块实例化耗时未知）。
- 不证公网 provider / TLS / 合法域名白名单（业主裁决项）。
- 不证上传包限 —— 模拟器接受 3.9MB 分包不等于微信平台验收。
- session/config/oauth/journal 持久化面在宿主层返回「缺席」码（-1/-2），core 容错通过；产品化需 `wx.storage` 实现。
- `mp/fx/env.js` 的随机数兜底是 xorshift（非 CSPRNG）—— 仅 spike 用；真机须先探 `crypto.getRandomValues`/`wx.getRandomValues` 可用性。
- prompt 经 chat.completions 面，非 Responses 面；语义对齐未跨协议验证。
