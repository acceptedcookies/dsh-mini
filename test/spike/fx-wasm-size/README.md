# test/spike/fx-wasm-size — fx-core.wasm 体积能否进 2MB 分包的取证宪章

> **一句话定义**：以 npm `libfx` 包内真实发布的 `fx-core.wasm` 为基准，实测其字节数、节区构成与可裁剪空间，回答「该 wasm 能否装进小程序单个分包（≤ 2MiB）」。本目录只产证据，不改公共合同，不动 `context/fx` 源码。

| 锚 | 值 |
|---|---|
| 建档日期 | 2026-11-03 |
| HEAD | `9ee4c28` |
| 上游真相 | `context/fx/CHANGELOG.md`（0.0.16：core wasm 2.15 MiB、terminal 3.39 MiB，`wasm-opt -Oz` 已优化）；`context/fx/sdk/AGENTS.md`（`fx-core.wasm` = headless ACP，`fx-term.wasm` = 终端，产物经 `sdk/scripts/optimize-wasm.mjs` 的 `wasm-opt -Oz`）；`context/fx/AGENTS.md`（CI 对 macOS arm64 二进制有体积上限） |
| 体积上限口径 | 微信小程序官方：单个分包 ≤ 2M。本宪章判据按保守值 `2 × 1024 × 1024 = 2097152` 字节；若平台按 `2000000` 解释，结论从严再核 |
| 组织先例 | `context/nano-agent/test/spike/`；dsh-mini `test/spike/README.md` |
| 环境 | 本机 macOS Node v22.22.0（全 H1 车道，离线可复跑；唯 FS-H1 首次需网络拉取 npm 包，产物缓存后可离线复跑） |
| 证据上限 | 只测「当前发布版」体积与裁剪下界；不改 fx 源码，**不回答** Zig feature-gate 的实际可达成性（那是设计/施工问题，属 [业主] 决策面） |

**边界声明**：本目录不改 `context/fx`；不生成进入产品包的 wasm；产物（npm tarball、解包文件、变换产物）全部 gitignore；结论被登记后可整体删除。

---

## §0 代码现实初步分析

- `fx-core.wasm` 官方口径 2.15 MiB ≈ **2,254,438 字节**（2.15×1024×1024，以 CHANGELOG 文本为准的近似值；实测以 FS-H1 落盘字节为准）。即当前发布形态**超过** 2MiB 分包上限约 7.6%。
- 产物已经 `wasm-opt -Oz`，常规 strip 收益预期接近 0——须实测，不得抄文档假设。
- `wasm-split` 二进制不在 binaryen npm 包内（`bin/` 无此项）；拆分路径的实测降级为节区级普查 + `wasm-metadce` 保留集估算。

### 0.5 发现台账

| ID | 发现 | 处置 |
|---|---|---|
| `F-01` | `wasm-split` 不可用（binaryen npm `bin/` 无此脚本） | FS-H3 改用节区普查 + metadce 估算，如实分级 |
| `F-02` | fx wasm 已经 -Oz，strip/重优化收益预期≈0 | FS-H2 实测验证，不得假设 |
| `F-03` | shipped 与 zig 0.17.0 源码构建均 strip name —— 函数级按名归属不可行 | FS-H6 改用 import 族调用图归属（直调边可达性下界 + call_indirect 站点计数） |
| `F-04` | `builtin_tools` flag 在 wasm 面翻转为零增量（实测） | 体积刀口不在工具面；列入 FS-H7 证据 |

---

## §1 本目录回答什么

1. `libfx@0.0.16` 实际分发的 `fx-core.wasm` 精确字节数及其相对 2MiB 的缺口。
2. 节区级体积构成（code / data / custom / 其余），定位可裁剪面。
3. `wasm-opt -Oz` + `--strip-*` 复核（验证 F-02）。
4. `wasm-metadce` 以「小程序入口所需导出」为根集的体积下界估算（作为 Zig feature-gate 可达性的代理证据，非承诺）。

5. `zig build -Dwasm-surface=core` 源码构建的体积复核（zig 0.17.0，prefix/cache 重定向，context/fx 不留痕）。
6. 按 **import 能力族** 的调用图字节归属（哪些代码可达 `fx_http`/`fx_session`/`wasi_*`，为包清单提供实测下界）。
7. 渐进热载顺序与拆分顺序的包清单（首包/次包/可选包，字节数字标注为归属下界）。

不回答：Zig 侧裁剪的具体改造方案与工作量；`wasm-split` 双模块链接在 WXWebAssembly 下的可用性（无工具，记 deferred）；真机加载时延（R 车道不覆盖，体积结论与设备无关）；`builtin_tools` 翻转为零增量现象的 Zig 内部机制归因（记为事实，机制另行调查）。

---

## §2 价值台账（`V-S*`）

| ID | 待证价值 | 判据（写死） | 承接行 |
|---|---|---|---|
| `V-S1` | `fx-core.wasm` 实测字节数 vs 2097152 | receipt 记精确字节与缺口百分比 | FS-H1 |
| `V-S2` | 节区构成普查 | 每节区 id/字节数/占比进 receipt | FS-H1 |
| `V-S3` | `wasm-opt -Oz --strip-*` 复核产物字节数 | 与基准差值；≈0 为预期发现 | FS-H2 |
| `V-S4` | metadce 保留集估算（根 = `memory`+`_start`+`asyncify_*`） | 产物字节数与是否 ≤2MiB | FS-H3 |
| `V-S5` | zig 源码构建复核：raw → 官方 wasm-opt 管线 → vs shipped | 三步字节数与差值百分比 | FS-H5 |
| `V-S6` | import 族调用图归属：各族 inclusive/exclusive 字节 | 55 个 import 全部归类，call_indirect 站点数进 receipt | FS-H6 |
| `V-S7` | `builtin_tools` 翻转实验：false 构建 vs 基线字节差 | delta 值；=0 为「工具面非体积杠杆」实测 | FS-H7 |
| `V-S8` | 渐进热载顺序 + 拆分清单 manifest | 三包内容清单 + 归属字节 + 加载/拆分顺序 | FS-H8 |

**收口判断**：
- `V-S1` ≤ 2097152 → 直接可分包，体积风险消除；
- `V-S1` > 2097152 且 `V-S4` ≤ 2097152 → 「需 Zig 侧裁剪/拆分」成立，工程量问题上交 [业主]；
- `V-S1` > 2097152 且 `V-S4` > 2097152 → 单 wasm 路径高危，必须拆分或改造（记 RED 级事实，不代表否决整个路线——拆分为 deferred 未证）。

---

## §3 测试方法

### 3.1 行与车道

全 H1 车道。FS-H1~H4 独立可跑（缺失缓存时自动先拉取）；FS-H7 依赖 FS-H5 的源码构建基线，FS-H8 消费 FS-H1/FS-H6 的 receipt——按 `needs` 顺序执行。

### 3.2 判读门槛

- 基准：`fixtures/fx-core.wasm`（gitignore，由 `npm pack libfx@0.0.16` 解包；receipt 记 `dist-tarball` URL、文件 sha256、字节数——三方一致才算基准成立）。
- 测量器：`lib/sections.mjs` 自解析 wasm section headers（不依赖外部工具）；`ref/section-check.mjs` 用 `binaryen` 模块导出数独立复核函数段规模。
- 判据按 §2 写死执行。

### 3.3 证伪镜像

| ID | 植入 | 预期 |
|---|---|---|
| `P-size-fat` | 向基准 wasm 追加 1MiB custom section | 测量器必须报 >2MiB 且节区普查必须列出该 custom 节——否则测量器失效 |

### 3.4 预算

`objects ≤ 6`（npm 缓存 + 基准 + 变换产物 + 镜像产物）、`opsCap ≤ 30`、`bytesCap ≤ 32 MiB`、`stopCondition: first RED`。npm 网络拉取仅 FS-H1 首次一次；`remoteOps=1`。

---

## §4 文件拓扑

```text
test/spike/fx-wasm-size/
├─ README.md                本宪章
├─ .gitignore               evidence/ 与 fixtures 产物
├─ ledger.mjs               FS-* 行契约
├─ harness/run.mjs          --plan | --check | <行号> | --all
├─ lib/preflight.mjs        node 版本 + npm 可用性门
├─ lib/envelope.mjs         receipt 信封（含文件 sha256 记录）
├─ lib/versions.mjs         版本钉
├─ lib/fetch-libfx.mjs      npm pack + 解包 + 校验（tarball URL/sha256 进 receipt）
├─ lib/sections.mjs         wasm 节区普查器（自解析）
├─ ref/section-check.mjs    binaryen 侧独立复核（函数/导出计数）
├─ lib/zig-build.mjs        zig 构建驱动（prefix/cache 重定向至 fixtures/，context/fx 无痕）
├─ lib/callgraph.mjs        import 族调用图归属（code 段自解析 + wasm-objdump 边）
├─ fixtures/fatten.mjs      镜像生成器（追加 custom section）
├─ fixtures/*.wasm .bin     生成产物（gitignore：npm 解包/zig 构建/变换/镜像）
├─ fixtures/package-manifest.json  FS-H8 产出的包清单（gitignore）
├─ rows/fs-h1.mjs           基准字节数 + 节区普查（V-S1, V-S2）
├─ rows/fs-h2.mjs           wasm-opt -Oz/strip 复核（V-S3）
├─ rows/fs-h3.mjs           metadce 保留集下界估算（V-S4）
├─ rows/fs-h4.mjs           P-size-fat 镜像行（测量器自证）
├─ rows/fs-h5.mjs           zig 源码构建复核（V-S5）
├─ rows/fs-h6.mjs           import 族调用图归属普查（V-S6）
├─ rows/fs-h7.mjs           builtin_tools 翻转零增量实验（V-S7，临时 patch build.zig + finally 还原）
├─ rows/fs-h8.mjs           渐进热载顺序 + 拆分清单（V-S8）
└─ evidence/                per-run receipt（gitignore）
```

---

## §5 行台账

| ID | 名称 | 车道 | 价值 | 级 | 前置 |
|---|---|---|---|---|---|
| `FS-H1` | 基准字节数 + 节区普查 | H | V-S1 V-S2 | H1 | — |
| `FS-H2` | wasm-opt 复核（F-02 验证） | H | V-S3 | H1 | —（自动拉缓存） |
| `FS-H3` | metadce 保留集下界估算 | H | V-S4 | H1 | —（自动拉缓存） |
| `FS-H4` | P-size-fat 测量器自证 | H | — | H1 | —（自动拉缓存） |
| `FS-H5` | zig 源码构建复核 | H | V-S5 | H1 | FS-H1；`zig 0.17+`（缺失记 NOT_RUN） |
| `FS-H6` | import 族调用图归属普查 | H | V-S6 | H1 | FS-H1 |
| `FS-H7` | builtin_tools 翻转零增量实验 | H | V-S7 | H1 | FS-H5 基线；临时 patch+还原 context/fx/build.zig |
| `FS-H8` | 渐进热载顺序 + 拆分清单 | H | V-S8 | H1 | FS-H1 FS-H6 的 receipt |

## §6 收口回填

执行日期 2026-11-03，HEAD `9ee4c28`（工作区未提交）。基准：`libfx@0.0.16` npm tarball 内 `fx-core.wasm`，sha256 与字节数已入 receipt。

| 行 | 终态 | 级 | 结论摘要 |
|---|---|---|---|
| FS-H1 | PASS | H1 | V-S1 = **2,260,477B**，超 2MiB 上限 **163,325B（7.8%）**；节区普查：code 2,037,033B（90.12%）/ data 216,770B（9.59%）/ 其余 &lt;1%；函数 2,996、导出 2（`memory`,`_start`）、导入 55 |
| FS-H2 | PASS | H1 | V-S3：`-Oz` 仅省 13,551B（→2,246,926B），strip 系列合计省 514B —— 上游产物已充分优化，工具链层面**抠不回缺口** |
| FS-H3 | PASS | H1 | V-S4 = **2,250,494B**，仍以 `_start` 为根全图可达 —— 入口可达下界即超线，**死代码消除救不了** |
| FS-H4 | PASS | H1 | P-size-fat fired + restored：测量器如实报 3,309,067B 且列出植入 custom 节 |
| FS-H5 | PASS | H1 | V-S5：**zig 0.17.0 首次构建成功** —— raw 2,632,761B → 官方 wasm-opt 管线 2,269,872B，与 shipped 差 9,395B（0.42%）；源码构建依然超线 |
| FS-H6 | PASS | H1 | V-S6：import 族归属 —— **wasi_fs 最大：inclusive 1,157,886B（56.8%）/ exclusive 357,797B**；引擎核（零 import 可达）855,589B；多族共享池 800,089B；call_indirect 站点 3,688（归属为下界） |
| FS-H7 | PASS | H1 | V-S7：**builtin_tools=false 构建与基线逐字节相同（delta 0B）** —— 该 flag 在 wasm 面是 no-op，工具面非体积杠杆（机制未归因，记事实） |
| FS-H8 | PASS | H1 | V-S8：`fixtures/package-manifest.json` 已产出 —— 三包清单 + 热载顺序 + 拆分顺序，字节为归属下界 |

镜像：P-size-fat 自证通过。

### 收口判断（按 §2 写死判据执行）

命中第三条分支：`V-S1` > 2097152 且 `V-S4` > 2097152 → **单 wasm 路径高危**。事实含义：

1. 缺口只有 7.8%，但三把常规刀都钝——产物已 -Oz、无冗余导出、`_start` 可达集即全模块。剩下的路只有两条：**Zig 侧 feature-gate 裁剪**（MCP engine、shell、gateway 面、terminal 面，改动 fx 源码属上游施工）或 **`wasm-split` 多模块加载**（本工作区无工具验证 WXWebAssembly 下双实例内存/表链接，记 `deferred`）。
2. 体积问题在**代码**（90%），不在数据——提示裁剪收益主要来自功能面整段移除，而非资源/字符串瘦身。
3. 体积事实与 `fx-wasm-jspi` 的 Asyncify 结论叠加：Asyncify 变换本身会让产物再长 ~15–30%（toy 上 37B→551B 的比例不可外推，但方向为增），**超线缺口只会更大**——单 wasm 直装路线按现有证据不成立。

### 包内容清单（FS-H8 manifest 的 durable 版；字节 = 调用图归属下界，非可运行产物）

**pkg0 首包 — 引擎核 + LLM 传输**（归属下界 ≈864,740B）
- 内容：agent loop / prompt 组装 / 协议解析（855,589B 零 import 可达函数群）+ `fx_http_request`/`fx_http_stream_*` SSE 出口边界（9,151B 独占）+ `_start` 启动
- 语义：装完即可发出第一个请求并流回第一个 token；会话写入、工具桥等在此包**就位但可延迟接通**

**pkg1 次包 — 会话与工具桥**（归属下界 ≈481,955B）
- 内容：`fx_session_load/commit/list/remove`（239,651B incl）、`fx_journal_flush`（3,478B）、`fx_steering_*`（3,613B）、`fx_host_tool_call` + result read/release（235,213B incl — 小程序宿主工具桥，dsh-mini 侧 wx-FS/网络工具经此注入）
- 语义：一轮完整 turn（工具调用、断点接管、会话落盘）依赖此包

**pkg2 可选包 — 无小程序语义的能力族**（归属下界 ≈2,188,052B，含大量共享）
- `wasi_fs`（fd_\*/path_\* 29 个 import，**inclusive 1,157,886B / exclusive 357,797B — 全模块最大单族**）：小程序无 POSIX fs，属最大可裁候选
- `wasi_other`（args/environ/clock/random/proc_exit，inclusive 784,048B — 大部分可用宿主垫片）
- `oauth`（fx_oauth_session_*，245,825B incl — ChatGPT/Grok 订阅登录，BYOK 场景可整族裁）
- `attachment`（fx_attachment_*，293B — 图片附件，可选）
- **未分配共享池 800,089B**：同时可达 ≥2 族的胶水函数（agent runtime 同时摸 session+http+tools）——真实拆分必须决定其归属，归属不同包结果不同

### 渐进热载顺序（loadOrder）

`pkg0 → pkg1 → pkg2`：首包落地即进入可交互态（第一个 token 可流回），pkg1 在首个 turn 需要工具/持久化前加载，pkg2 仅在用到对应能力时按需。

### wasm 拆分顺序（splitOrder）

1. **WASI fs 族整族源码级 gate** —— 小程序宿主本无 POSIX，fd/path 调用本应编译期消去；exclusive 358KB 实测 + inclusive 1.16MB 上限，是收益最大、语义最干净的刀口。
2. **oauth/attachment 宿主边界整族 gate** —— BYOK 无订阅登录，图片附件可选。
3. **若仍超线，session/journal 与 engine 间打 wasm-split 边界** —— npm binaryen 无 wasm-split（F-01），WXWebAssembly 双模块链接未证（deferred）。

### 诚实边界

- pkg 字节为**直接调用图归属下界**（3,688 个 call_indirect 站点未追踪）——不是可链接产物，真实拆分产物可能更大。
- `builtin_tools` 翻转零增量：工具面不是体积杠杆；刀口在 wasi_fs/oauth/wasi_other 族与引擎核本身。
- FS-H5 验证了源码管线可复现（差 0.42%），体积结论同时适用于 shipped 与 source-built 工件。
