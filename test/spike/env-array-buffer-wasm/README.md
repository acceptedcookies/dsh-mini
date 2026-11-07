# test/spike/env-array-buffer-wasm — WXWebAssembly 字节实例化路径取证宪章

> **一句话定义**：回答「`WXWebAssembly` 能否从 ArrayBuffer（运行时字节）实例化 wasm——即 wasm 以密文/网络字节形态存在、内存解密后 `new Module(bytes)` → `new Instance` 的路径在 H1/S1/R1/R2 是否成立；并实测真实量级 wasm（fx-core-async.wasm ≈4.0MB）该管线的分段耗时」。本目录只产证据，不改公共合同，不施工产品代码。

| 锚 | 值 |
|---|---|
| 建档日期 | 2026-11-06 |
| HEAD | 建档时工作区（未提交） |
| 上游真相 | `node_modules/miniprogram-api-typings/types/wx/lib.wx.wasm.d.ts`（WXWebAssembly 类型面：`Module(bytes)`/`Instance(module,imports)`/`Memory`/`Table` + `instantiate(path)`；**无** `Global`/`Suspending`/`promising`/`compile`/`validate`）；`services/fx/env.ts`（现役 `instantiate(path)` + `ensureSubpackageForPath` 分包依赖）；`test/spike/fx-wasm-agent/fixtures/fx-core-async.wasm`（4,098,991B asyncify 产物，实测 55 个 function import、0 个 memory/table/global import）；`test/spike/fx-wasm-jspi`（JSPI 缺席、Asyncify S1 级成立、`instantiate` resolve `{module,instance}` 勘误） |
| 组织先例 | `context/nano-agent/test/spike/`（neo）；dsh-mini `test/spike/README.md`；同工作区 `fx-wasm-jspi`/`fx-wasm-stream` 宪章 |
| 环境 | 本机 macOS Node v22（H1）；微信开发者工具（S1，`/Applications/wechatwebdevtools.app`）；真机 iOS/Android（R1/R2，需 [业主] 设备 + LAN mock 点收） |
| 证据上限 | S1 结论不覆盖真机；mock 只绑 127.0.0.1（R 车道 LAN 需 [业主] 点收）；XOR 变换是流水线计时替身，不代表 AES-GCM 成本；fixture 缺席行记 `NOT_RUN` |
| 判读口径 | bytes 路径是本 spike 的**承重路径**：能力缺席/实例化失败 = `RED`（不是「事实登记」）；判据写死在 §2，跑完不挪 |

**边界声明**：不改产品代码（`services/fx/*`、`subpkg/*` 一律不动）；spike 小程序工程 `mp/` 独立，`urlCheck=false`；mock 默认绑 127.0.0.1，`--lan`/`SPIKE_MOCK_LAN=1` 绑 0.0.0.0 仅供 R 车道（receipt 记 `bind` 事实）；XOR keystream 为确定性**非密码学**替身，密文强度不在本 spike 范围；真实 provider/云函数调用为零；本目录结论被 [业主] 登记后可整体删除。**政策登记**：`WXWebAssembly.Module(bytes)` 属 typings 存在但官方文档未承诺的面，可被基础库版本收回；「wasm 动态下发」与小程序代码管控政策的关系未审——技术 PASS ≠ 审核能过，此为 [业主] 裁决项非证据项。

**设计动机（背景事实，非本 spike 结论）**：wasm 可被解包反解 → 「密文下发 + 会话变体」是端上唯一候选防护；其前提 = 字节能在包外以 ArrayBuffer 形态实例化。本 spike 只验证该前提与成本，不验证变换器/密钥协议/产品接线（均为后续设计与合同项）。

---

## §0 代码现实初步分析

建档时可复核事实（非行为 PASS）：

- **WXWebAssembly 类型面已含字节构造器**：`lib.wx.wasm.d.ts` 声明 `new Module(bytes: BufferSource)`、`new Instance(module, importObject?)`、`new Memory`、`new Table`，及 `Module.imports/exports/customSections` 三个静态内省方法；`instantiate(path, imports)` 仅收路径。**无 `Global` 构造器**——imported global 最多以 number 兜底（仅 immutable numeric 可被 JS API 接受），fx 被测物无 global import 故无碍。**无 JSPI**（`fx-wasm-jspi` 已证）。
- **fx-core-async.wasm 实测形态**（Node 22 对照）：4,098,991B；`Module.imports` = 55 个**全部 function**（`wasi_snapshot_preview1.*` + `fx.*`），0 memory/table/global import；exports = `memory` + `_start` + 4 个 asyncify 运行时函数。含义：**stub-instance 可行**——`Module.imports` 描述符自动生成桩 importObject 即可链接，不调用 `_start` 时 import 返回值类型不被检查，链接成本即可测。
- **现役加载路径有分包依赖**：`services/fx/env.ts` `instantiate(path)` → `ensureSubpackageForPath(path)` → `WXWebAssembly.instantiate(path)`。bytes 路径若成立，wasm 可完全移出代码包（HTTP/云存储字节），分包依赖对该路径不适用——这是 V-A5 的证据形态。
- **mock 可达性有先例**：`fx-wasm-stream` ST-S1 已证 DevTools 模拟器内 `wx.request` 可达 `127.0.0.1` mock（`urlCheck=false`）。
- **crypto.subtle 存在性未证**：小程序 JS 面有无 WebCrypto 未实测；AES-GCM 实现选型（纯 JS vs wasm 解密器）是后续设计项，本 spike 只把 `crypto.subtle`/`getRandomValues` 存在性记为 API 面事实。

### 0.5 发现台账

| ID | 发现 | 处置 |
|---|---|---|
| `F-01` | `Module(bytes)` 是 typings 有、官方文档未承诺的面——可被基础库版本收回；wasm 动态下发与平台代码管控政策的关系待裁决 | 已登记边界声明；[业主] 裁决项 |
| `F-02` | **决定性**：S1（baseLib 3.17.5, DevTools, wechat 8.0.5）`WXWebAssembly` 全部入口只收包内 .wasm/.wasm.br 路径——`Module(bytes)`/`Module(view)`/`compile(bytes)`/`instantiate(bytes)`/`instantiate(USER_DATA_PATH 临时文件)`/`Module(wxfile:/usr:/http:)` **全部拒绝**（"only support file type .wasm or .wasm.br" / "first argument must be a string" / "not support wxfile: or http: path"）；`Module(path)`/`compile(path)`/`instantiate(path)` 正常（echo()=42）| 密文下发前提 **S1 级否决**；见 §6 |
| `F-03` | apiSurface 事实：sim 上 `WXWebAssembly.Global`/`compile` 存在（typings 未声明）、`validate`/`stdWasm`(标准 WebAssembly) 缺席、`crypto.subtle` 缺席、`wx.getRandomValues` 存在 | AES-GCM 需纯 JS 实现；Global/compile 为文档外事实 |

---

## §1 本目录回答什么

1. 各环境 `WXWebAssembly.Module`/`Instance`/`Memory`/`Table` 构造面与 `Module.imports/exports/customSections` 内省面（V-A1）。
2. 同一 echo.wasm 字节经 path 与 bytes 两路径实例化等价（`echo()`=42），bytes 路径接受 ArrayBuffer 与 Uint8Array view（V-A2）。
3. 「fetch 密文 → 内存 XOR 解密 → `Module` → `Instance` → 调用」管线在 echo 量级端到端成立，wrongKey/trunc 两个负臂正确抛错（V-A3）。
4. 真实量级 fx-core-async.wasm（≈4.0MB）经同管线 `Module` 编译 + stub `Instance` 链接成立，产出 fetch/decrypt/compile/link 分段耗时（V-A4）。
5. 上述 bytes/enc/fxReal 三臂字节全部来自 HTTP mock、包内无对应 wasm ⇒ 「wasm 移出代码包」在 S1 级成立（V-A5，由 S1–S3 组装）。

**本目录不回答**：AES-GCM/会话密钥协议选型；wasm→wasm 变换器（会话变体）；云函数/云托管下发协议；`services/fx/env.ts` 产品改造；`Module(bytes)` 大小上限的确切边界（只证 ≈4.0MB 这一档）；真机引擎差异（R 车道另证）。

---

## §2 价值台账（`V-A*`）

| ID | 待证价值 | 判据（写死） | 承接行 |
|---|---|---|---|
| `V-A1` | `WXWebAssembly` 字节构造面存在 | `Module`/`Instance`/`Memory`/`Table` 四个构造器均 `function`；`Module.imports`/`exports`/`customSections` 三个静态均 `function` | AB-H1（对照）、AB-S1 |
| `V-A2` | bytes 路径实例化等价 path 路径 | 同一 echo.wasm：`instantiate("wasm/echo.wasm")` 与 fetch→`Module(bytes)`→`Instance` 的 `echo()` 均 =42；`Module` 接受 ArrayBuffer 与 Uint8Array view | AB-H1（对照）、AB-S1 |
| `V-A3` | 加密下发管线端到端成立（echo 量级） | `/echo.enc` → wx.request → XOR 解密 → `Module` → `Instance` → `echo()`=42；且解密字节与 `/echo.wasm` 原始字节逐位相等（roundtripEq）；`?key=bad` 与 `?trunc=half` 两负臂均在 `Module`/`Instance` 阶段抛错 | AB-H2（对照）、AB-S2 |
| `V-A4` | 真实量级 wasm 字节管线「编译+链接」成立 | `/fx-core-async.enc` → 解密（fnv32 字节级校验）→ `new Module` 编译成功；`Module.imports` 计数 >0 且全部 function；stub `Instance` 链接成功、`exports.memory` 与 `asyncify_get_state` 存在；**stub 调用计数=0**（只链接不运行 `_start`）；分段耗时入 detail。**措辞边界**：本值只证 compile+link；「密文 fx wasm 可运行」= 本行证据 ∧ `fx-wasm-agent` AG-S3（`instantiate(path)`→run 先例）的组合推断——bytes-Module 与 path-Module 实例化后行为差异是残余风险，未实测 | AB-H3（对照）、AB-S3 |
| `V-A5` | wasm 脱离代码包实例化在 **S1 技术级**成立 | bytesRaw/encPipeline/fxReal 臂字节全部来自 HTTP mock（`baseHost` 对账入断言），mp 包内仅 `wasm/echo.wasm`（path 对照专用）；生产通道（合法域名/HTTPS/云存储/响应上限）**不在本值范围**，需另行裁决 | AB-S1、AB-S2、AB-S3 |

**收口判断**：
- `V-A1` ∧ `V-A2` RED → bytes 路径不成立，「密文下发」前提被否决，一票升级给 [业主]；
- `V-A3` RED 而 `V-A2` PASS → 管线在解密/完整性环节出问题，定位到具体 arm；
- `V-A4` RED → ≈4.0MB 这一档有硬限制（Module 大小上限/内存/耗时不可接受），密文下发需重新评估分片或裁剪；
- `V-A4` PASS 但耗时数据异常（如 compile >10s）→ 记事实，是否可接受由 [业主] 裁决（spike 不设性能红线）；
- R 行缺席 → 结论等级标「S1 级」，不得写成设备级。

---

## §3 测试方法

### 3.1 终态与分级

终态：`PASS` / `RED`（附首条不符项）/ `NOT_RUN`（附原因）/ `deferred`（附前置）。分级见总 README §3（H1/S1/R1/R2）。

### 3.2 行与车道

| 车道 | 行前缀 | 执行体 |
|---|---|---|
| host | `AB-H*` | Node 直跑：wat→wasm、XOR 变换互逆、mock server + fetch 管线对照、真实 fx wasm 宿主基线 |
| sim | `AB-S*` | `miniprogram-automator` 拉起 `mp/` 工程；mock server 供 HTTP 字节；页面探针跑全部 arms，automator 抓 `globalData.probeResult`，行按段断言 |
| device | `AB-R*` | 同工程真机预览；`--lan` mock + 页面手动输入 LAN URL；结果自动 `POST /report` 落盘（剪贴板兜底），`SPIKE_RESULT_JSON` 指向文件 |

### 3.3 fixture 与变换契约

- `fixtures/echo.wat`：`export echo() -> i32.const 42` —— 控制臂。
- `fixtures/bad.wat`：import `env.missing` 未提供 —— `Module` 编译应过、`Instance` 必须抛 LinkError（P-bytes-bad 的链接臂）。
- `fixtures/evil.wat`：`export echo() -> i32.const 7` —— **合法但错误**的模块（P-valid-swap：解密后 Module 不拒绝且跑出 7，实证「引擎验证格式 ≠ 防篡改」）。
- **变换规格**（`lib/transform.mjs` canonical，`mp/probe/transform.js` 同步副本，`--check` 每次执行做字节一致性对账）：FNV-1a(label) → LCG32（`state = state*1664525 + 1013904223 mod 2^32`，取低字节）逐字节 XOR。enc/dec 同一函数（involution）。label：`echo` / `fx-core-async`；wrongKey 臂服务端用 `echo-bad` label 加密、客户端仍按 `echo` 解密 → 必然垃圾 → `Module` 抛错。**非密码学**，仅测流水线成本。另提供 `fnv1a32` 校验和（引擎校验等价物，非 MAC）供 4MB 臂做字节级完整性。
- **mock 端点**（`lib/wasm-server.mjs`，默认 127.0.0.1，`--lan`/`SPIKE_MOCK_LAN=1` 绑 0.0.0.0）：`GET /echo.wasm` `/bad.wasm` `/evil.wasm`（原始字节）；`GET /echo.enc` `/evil.enc`（XOR 密文，`?key=bad` 换 label、`?trunc=half|N` 切片）；`GET /fx-core-async.enc`（4MB 密文）；`GET /fx-core-async.fnv`（原文 fnv32，供客户端对账）；`POST /report`（R 车道证据回填：写 `<evidenceDir>/device-report-<UTC>.json`）。服务端每请求 `readFileSync` + 现算 XOR——`fetchMs` 混入服务端 IO/变换耗时，4MB 量级是可观噪音，计时字段仅作同环境相对比较。
- **standalone mock**（R 车道）：`node lib/wasm-server.mjs --dir fixtures --lan --evidence evidence/device`，打印 loopback + LAN URL + report sink。
- **真实量级 fixture**：`--build` 从 `../fx-wasm-agent/fixtures/fx-core-async.wasm` 拷入 `fixtures/`（两处均 gitignored、可再生）；源缺席 → AB-H3/AB-S3 记 `NOT_RUN`。

### 3.4 证伪镜像（plants）

| ID | 类 | 植入 | 预期 |
|---|---|---|---|
| `P-bytes-bad` | wasm 管线 | 垃圾字节 `Module` 必须抛；`bad.wasm` `Instance` 必须抛 | 不抛则管线判读失效 |
| `P-wrong-key` | 解密判别力 | `?key=bad` 密文按正确 label 解密 | `Module` 必须抛且记 `errorName`；不抛则「解密失败可检出」不成立 |
| `P-trunc-wasm` | 完整性判别力 | `?trunc=half` 截断密文解密 | `Module` 必须抛且记 `errorName` |
| `P-valid-swap` | 完整性上界 | `evil.wasm`（合法但 `echo()=7`）密文解密后喂 `Module`/`Instance` | 引擎**必须不拒绝**且跑出 7——实证「引擎验证格式 ≠ 防篡改」，MAC/长度校验是调用方责任 |
| `P-transform-roundtrip` | 变换自检 | enc/dec 互逆且 wrong-label 解密 ≠ 原文 | H 行自检 + `--check` 镜像字节一致性，失败则后续全部判读作废 |
| `P-stub-quiet` | fxReal 纪律 | stub import 计数器在链接后必须 =0 | >0 说明误调用了 `_start`/import，fxReal 证据作废 |

### 3.5 预算

默认 `objects ≤ 6`（wasm/enc 产物数）、`opsCap ≤ 80`、`bytesCap ≤ 40 MiB`（4MB 密文+明文+模块副本）、`stopCondition: first RED`（`--all` 对 `needs` 中含本次 RED 的行记 `NOT_RUN(dep <id> RED)`；单行内 first-red 合法终态）。`budgetUsed` 由行回填实数（probe `stats.httpOps/httpBytes` + 对象计数）。automator 拉起超时 60s；echo 量级行 grab 超时 120s，fxReal 行 180s（4MB 编译留裕量）。

**计时语义**：`compileMs` = `new Module(bytes)` 构造器墙钟——若引擎把编译推迟到 `Instance`/首调，compileMs 会低估而 linkMs 吸收差值；分段值是构造点墙钟不是阶段保证。`totalMs` = 主链分段之和；`armWallMs` = 整臂墙钟（含负臂 fetch）。

### 3.6 证据落点

`evidence/<id 小写>/<UTC>.json`（gitignore）。设备行 receipt 须含 `device{model, osVersion, wechatVersion, baseLibVersion}`（`wx.getDeviceInfo`/`wx.getAppBaseInfo` 抓）；mock `bind` 事实记入 detail。

### 3.7 执行步骤（发车顺序）

```text
0. 契约自检   node harness/run.mjs --check     # 行文件/依赖/预算完整性
             node harness/run.mjs --plan       # 行清单预览
1. 构建产物   node harness/run.mjs --build     # mp/wasm/echo.wasm + fixtures/{echo,bad}.wasm + echo.enc
             #                        + fx-core-async.wasm 拷贝（源缺席仅影响 H3/S3）
2. H 车道     node harness/run.mjs AB-H1       # 宿主对照：bytes 实例化 + 变换互逆 + 镜像
             node harness/run.mjs AB-H2       # mock + Node fetch 管线对照（V-A3 host）
             node harness/run.mjs AB-H3       # 真实 fx wasm 宿主基线（V-A4 host；fixture 缺席→NOT_RUN）
3. S 车道     node harness/run.mjs AB-S1       # DevTools：API 面 + path/bytes 对照（V-A1/V-A2/V-A5）
             node harness/run.mjs AB-S2       # DevTools：加密管线 echo 量级（V-A3/V-A5）
             node harness/run.mjs AB-S3       # DevTools：真实 fx wasm 字节管线 + 分段耗时（V-A4/V-A5）
4. R 车道     [业主] 真机预览 mp/；起 LAN mock：
             node lib/wasm-server.mjs --dir fixtures --lan --evidence evidence/device
             页面输入打印的 http://<LAN-IP>:<port> → 全臂跑完自动 POST /report 落盘
             （剪贴板 copy json 兜底）→ SPIKE_RESULT_JSON=<落盘文件> + SPIKE_DEVICE_* 环境变量
             node harness/run.mjs AB-R1        # iOS（deferred D-1）
             node harness/run.mjs AB-R2        # Android（deferred D-2）
5. 一键       node harness/run.mjs --all       # R 行 deferred → 自动 NOT_RUN；dep RED → 后继 NOT_RUN
```

每行独立拉起 DevTools 工程；automator 通过 `globalData.probeConfig {base, arms}` 注入本轮臂集合（ledger `arms` 字段）——行只跑被断言的臂，单臂崩毁不拖死无关行；`probeResult` 逐臂增量落盘（臂完成即写 `globalData`），崩溃也保留已完成臂的证据。探针页 300ms 轮询属一次性触发机制（非自唤醒循环，先例：`fx-wasm-stream`）。first-red 是合法终态，补测另写新 receipt。

---

## §4 文件拓扑

```text
test/spike/env-array-buffer-wasm/
├─ README.md                 本宪章
├─ .gitignore                evidence/、mp/wasm/*.wasm、fixtures/*.{wasm,enc}
├─ ledger.mjs                AB-* 行契约
├─ harness/run.mjs           --plan | --check | --build | <行号> | --all
├─ lib/preflight.mjs         环境门（host-node/devtools-sim/ios/android）
├─ lib/envelope.mjs          receipt 信封与落盘
├─ lib/versions.mjs          node/devtools/wabt 版本钉
├─ lib/automator.mjs         miniprogram-automator 封装（setTargetConfig 注入臂集 + evaluate 超时 + 增量抓取）
├─ lib/transform.mjs         XOR keystream 变换 canonical（非密码学替身）
├─ lib/wasm-build.mjs        wat→wasm（wabt）+ --build 产物生成（含 fx 拷贝）
├─ lib/wasm-server.mjs       mock HTTP：raw/enc/fnv 端点 + POST /report + standalone --lan 入口
├─ lib/stubs.mjs             Module.imports → stub importObject（host 臂）
├─ ref/probe-spec.mjs        独立探针形状清单（与 mp/probe 分开实现，对拍用）
├─ fixtures/echo.wat         控制臂 wasm 源
├─ fixtures/bad.wat          镜像：缺 import 模块源
├─ fixtures/evil.wat         镜像：合法但 echo()=7 的换包模块源
├─ fixtures/{echo,bad,evil}.wasm  --build 生成（gitignore）
├─ fixtures/echo.enc         --build 生成（gitignore）
├─ fixtures/fx-core-async.wasm  --build 从 fx-wasm-agent 拷入（gitignore，缺席→H3/S3 NOT_RUN）
├─ rows/ab-h1.mjs            H1：宿主 bytes 实例化 + 变换互逆（V-A1/V-A2 对照）
├─ rows/ab-h2.mjs            H1：mock+fetch 管线对照（V-A3 对照）
├─ rows/ab-h3.mjs            H1：真实 fx wasm 宿主基线（V-A4 对照）
├─ rows/ab-s1.mjs            S1：DevTools API 面 + path/bytes 对照（V-A1/V-A2/V-A5）
├─ rows/ab-s2.mjs            S1：DevTools 加密管线 echo 量级（V-A3/V-A5）
├─ rows/ab-s3.mjs            S1：DevTools 真实 fx wasm 管线 + 分段耗时（V-A4/V-A5）
├─ rows/ab-r1.mjs            R1：iOS 真机（V-A1/V-A2/V-A3/V-A5；V-A4 机会项）
├─ rows/ab-r2.mjs            R2：Android 真机（同 R1）
├─ mp/                       独立 spike 小程序工程（产品 AppID，urlCheck=false）
│  ├─ project.config.json
│  ├─ app.json / app.js      globalData { probeResult, targetBase }
│  ├─ pages/index/*          探针页：轮询 targetBase 自动跑 / 手动输入 URL（设备）
│  ├─ probe/probe.js         全 arms 探针（surface/pathBaseline/bytesRaw/encPipeline/fxReal）
│  ├─ probe/transform.js     XOR 变换 mp 副本（与 lib/transform.mjs 同步）
│  └─ wasm/echo.wasm         --build 生成（gitignore，path 对照臂专用）
└─ evidence/                 per-run receipt（gitignore）
```

---

## §5 行台账

| ID | 名称 | 车道 | 价值 | 级 | 前置 |
|---|---|---|---|---|---|
| `AB-H1` | 宿主 bytes 实例化 + 变换互逆 | H | V-A1 V-A2 | H1 | — |
| `AB-H2` | mock+fetch 管线对照 | H | V-A3 | H1 | `AB-H1`；`--build` 产物 |
| `AB-H3` | 真实 fx wasm 宿主基线 | H | V-A4 | H1 | `fixtures/fx-core-async.wasm`（缺席→NOT_RUN） |
| `AB-S1` | DevTools API 面 + path/bytes 对照 | S | V-A1 V-A2 V-A5 | S1 | `AB-H1`；`--build` 产物 |
| `AB-S2` | DevTools 加密管线 echo 量级 | S | V-A3 V-A5 | S1 | `AB-H2` `AB-S1` |
| `AB-S3` | DevTools 真实 fx wasm 管线 | S | V-A4 V-A5 | S1 | `AB-H3` `AB-S2`；fx fixture |
| `AB-R1` | iOS 真机全臂 | R | V-A1 V-A2 V-A3 V-A5（V-A4 机会项） | R1 | `AB-S3`；`D-1` 真机 + LAN mock |
| `AB-R2` | Android 真机全臂 | R | 同 R1 | R2 | `AB-S3`；`D-2` |

`D-1`/`D-2` = [业主] 提供真机、授权预览安装并点收 LAN mock（`SPIKE_MOCK_LAN=1`），未点收即 `NOT_RUN`。

---

## §6 收口回填

**执行**：2026-11-06，`--all`（H/S/R 全序列）。

| 行 | 终态 | 关键证据 |
|---|---|---|
| AB-H1 | **PASS** | 宿主对照全绿：Module(bytes)+Instance→42、view 接受、变换互逆、负臂按预期错误类抛 |
| AB-H2 | **PASS** | mock+fetch 管线对照：roundtripEq、wrongKey/trunc/badLink 全拒（错误名在册）、valid-swap 不拒（引擎只验格式） |
| AB-H3 | **PASS** | 4MB fx wasm 宿主：Module×3 编译 + stub link、stubCalls=0、fnv `bbcd8b9e` |
| AB-S1 | **RED** | **V-A1/V-A2 否决**：`Module(bytes)`/`Module(view)` 抛 "only support file type .wasm or .wasm.br"；path 对照 `instantiate("wasm/echo.wasm")`=42 正常 |
| AB-S2 | **RED** | encPipeline 同一根因：解密正确但 `Module(明文)` 拒绝 |
| AB-S3 | **RED** | fxReal 同一根因：4MB 字节正确解密但 `Module` 拒绝 |
| AB-R1/R2 | NOT_RUN | deferred（业主门禁 D-1/D-2 未点收）+ dep RED |

**altEntries 探索臂（S1 内嵌取证）**：`Module("wasm/echo.wasm")` ✅42、`compile(path)` ✅42async、`compile(bytes)` ❌"first argument must be a string"、`instantiate(bytes)` ❌、`Module(view)` ❌、`Module(USER_DATA_PATH/tmp.wasm)` ❌"not support wxfile: or http: path"、`instantiate(tmp)` ❌、`Module("usr://…")` ❌no such file。

**收口结论（S1 级）**：`WXWebAssembly` 在 DevTools 模拟器（baseLib 3.17.5）是**纯包内文件 API**——wasm 只能以 `.wasm/.wasm.br` 存在于已上传的代码包/分包内；字节、临时文件、wxfile/usr/http 外部路径全部封死。「密文下发 → 内存解密 → 字节实例化」前提**被否决**（V-A1∧V-A2 RED）。R 车道因门禁未证，但拒绝发生在 WX API 参数校验层（非引擎能力层），真机同 API 语义大概一致——如需铁证待 [业主] 点收 R1/R2。

**对「密文下发/会话变体」设计的裁决建议**：该方案在小程序端**不成立**。剩余可行防护面只有两条：(a) 构建期 wasm→wasm 变换/混淆（仍在包内，只抬静态解包成本）；(b) 敏感计算留在云侧（CloudBase Run/云函数——本仓库既有边界）。分包懒加载只延迟解包时点不防解包。若要继续，下一个 spike 应改证「构建期 wasm 变换的调试/反编译抵抗度」而非下发路径。
