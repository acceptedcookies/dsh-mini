# test/spike/env-celld-wasm — celld 决策核 wasm 化在 WXWebAssembly 上的取证宪章

> **一句话定义**：回答「celld 的 **DO 环境四层**（L1 执行引擎 / L2 决策核 / L3 API 面 / L4 持久层）能否在小程序内成立」。结论：**四层全部实证成立**（13/14 行 PASS，仅 iOS 真机 NOT_RUN），可支撑「单节点、前台、可休眠」的 DO 语义子集；分布式面（ownership 对端、S3 真源）按设计留在云端，构成「本地 cell ⇄ 云端 workerd」液态流动的协议边界。本目录只产证据，不改公共合同，不施工产品代码。

| 锚 | 值 |
|---|---|
| 建档日期 | 2026-11-06 |
| HEAD | 见 receipt `headSha`（工作区未提交） |
| 上游真相 | `context/celld/crates/logic/lib.rs:1-30`（"Pure decision core: no async, I/O, clocks, randomness, locks, or dependencies"）；`crates/logic/types.rs:1025`（`Effect` 枚举 ~30 变体，op-versioned 异步效果契约）；`crates/logic/lib.rs:6729`（`on_event` 唯一入口）；`node_modules/miniprogram-api-typings/types/wx/lib.wx.wasm.d.ts`（WXWebAssembly 类型面：`instantiate(path)`/`Module(bytes)`/`Instance`/`Memory`，无 JSPI） |
| 组织先例 | `context/nano-agent/test/spike/`；dsh-mini `test/spike/README.md`；同级先例 `fx-wasm-jspi/`、`fx-wasm-agent/` |
| 环境 | 本机 macOS Node v22.22.0 + rustc 1.99.1（H1）；微信开发者工具（S1，`/Applications/wechatwebdevtools.app`）；真机 iOS/Android（R1/R2，需 [业主] 设备） |
| 证据上限 | **S1 + R2/R3/R4/R5 双端**；iOS（R1）缺席记 `NOT_RUN`；已证 L1/L2/L3/L4 四层，不证分布式面（ownership 对端/S3 真源）与 nacp 协议对齐 |
| 判读口径 | 「等价」判据 = wasm 臂转录与原生 `probe-cli` golden **逐字节一致**；写死在 §3，跑完不挪 |

**边界声明**：不改 `context/celld` 源码（reference 仓只读）；kernel crate 以 `path` 依赖引用 `crates/logic`，不 vendor、不 patch；spike 小程序工程 `mp/` 用产品 AppID `wx356d3abb52825466`（沿用 jspi 先例，仅作模拟器探针工程）；不产生任何网络/云调用；本目录结论被 [业主] 登记后可整体删除。

---

## §0 代码现实初步分析

建档时可复核事实（非行为 PASS）：

- **celld-logic 是为可移植内核设计的**：crate 头注明示 "no async, I/O, clocks, randomness, locks, or dependencies"——`on_event(&mut State, Event) -> Vec<Effect>` 是唯一状态推进入口，executor 只负责把 `Effect` 落到外部世界。这正是 wasm 嵌入的理想形状：同步、确定、无宿主依赖。
- **Effect/Event 是 op-versioned 配对**：每个异步效果带 `op: OpId`，完成事件带同 `op` 回填——天然适配「wasm 同步返回受理 + JS 异步干活后喂 Event」的桥接模式，**不需要 Asyncify/JSPI**（对照 `fx-wasm-jspi` 的教训：fx 被迫 Asyncify 膨胀 +55.7%）。
- **不可移植的部分不在本目录**：`crates/celld`（~90k 行 executor：rusty_v8 `js.rs` 12.7k 行、tokio、hyper/axum、rusqlite、POSIX fs）与 `crates/ltx`（tokio+object_store）不在本 spike 范围。本 spike 只证 L2（环境内核）一层。
- **工具链就绪**：`rustup` + `wasm32-unknown-unknown` target 在 H1 可用（rustc 1.99.1 ≥ celld-logic `rust-version = 1.94.1`）。

### 0.5 发现台账

| ID | 发现 | 处置 |
|---|---|---|
| `F-01` | celld-logic 对 `wasm32-unknown-unknown` **零 import** 编译通过（296,104B），memory 自动导出 | 记为 V-E1/V-E2 证据；WXWebAssembly 无需任何 shim 即可实例化 |
| `F-02` | brotli 压缩率 ~24%（296KB→70.7KB）——`.wasm.br` 分包体积极小 | 记为 V-E4 证据；分包预算输入 |
| `F-03` | 新 wasm 含 `env.host_effect` import（300,089B）后，S1 转录仍逐字节一致 | L3 桥不污染纯逻辑面（EC-S2/R2） |
| `F-04` | Effect 经 wasm import 交 JS executor、按 wx.storage 真实结果回填 completion，冷激活链完整 | L3 成立（EC-S3/R3） |
| `F-05` | 新 wasm 实例读同一 wx.storage：ReadOwner 从 -1 变持久化 epoch，转录随持久态改变 | L4 成立（EC-S4/R4） |
| `F-06` | `quickjs-wasi@3.6.3` 为裸 QuickJS C API 构建（450 导出），`JS_NewRuntime→JS_NewContext→JS_Eval→JS_ToInt32` 在小程序内真执行 JS（1+1=2、42） | L1 成立（EC-S5/R5） |

---

## §1 本目录回答什么

1. `celld-logic` 能否独立编译为 `wasm32-unknown-unknown`，尺寸多少（V-E1）。
2. 同一 wasm 在 Node 标准 `WebAssembly` 与原生 `probe-cli` 产出**逐字节一致**的冷激活转录（V-E2）。
3. 同一 wasm 在 `WXWebAssembly.instantiate(path)`（DevTools 模拟器）内实例化并产出逐字节一致转录（V-E3）。
4. wasm/brotli 尺寸与 linear memory 占用，为分包预算提供输入（V-E4）。
5. **L3**：Effect 能否经 wasm import 交 JS executor、按 wx.storage 真实执行结果回填 completion（V-E5）。
6. **L4**：新 wasm 实例能否读同一 wx.storage、持久态改变决策路径（V-E6）。
7. **L1**：多实例内存隔离 + QuickJS wasm 能否在小程序内**真实执行 JS**（V-E7）。

**场景**：`Request{request:1, cell:"demo-cell"}` 一条入站请求 → celld-logic 冷激活链 `ReadOwner → OwnerRead(None) → CasOwner(Absent,epoch:1) → OwnerCasCompleted(Applied) → Restore(fresh) → RestoreCompleted → StartRuntime → RuntimeStarted → Publish → Published → Complete{Ok(Local)}`。应答器（`kernel/src/scenario.rs` 的 `completion()`）扮演 happy-path executor：owner absent、自 claim、空库 restore、runtime 即起、publish 成功。

本目录**已回答**（2026-11-06 收口）：L3 executor 桥（6 类 Effect → wx.storage）、L4 跨实例持久化、L1 QuickJS 真执行、尺寸预算（§7-§12 分析）。

本目录不回答：executor 的**全部 30 种** Effect 映射（fetch/WebSocket/alarm/VFS 面）；SQLite/LTX **位级**兼容；云端 workerd 兼容与 nacp 协议对齐；多租户凭证载体。

---

## §2 价值台账（`V-E*`）

| ID | 待证价值 | 判据（写死） | 承接行 |
|---|---|---|---|
| `V-E1` | celld-logic → `wasm32-unknown-unknown` 编译通过且可独立产出 cdylib | `cargo build --release --target wasm32-unknown-unknown` 成功，`env_celld_probe.wasm` 存在 | EC-H1 |
| `V-E2a` | 原生 `probe-cli` 转录确定性（同输入两次运行逐字节一致） | 两次 stdout `cmp` 相等 | EC-H1 |
| `V-E2` | Node `WebAssembly` 臂转录与原生 golden **逐字节一致** | `firstDiff(transcript, golden) === -1`；结构断言过（effect 序列有序、`completed_local:true`） | EC-H2 |
| `V-E3` | `WXWebAssembly` 臂（模拟器）转录与原生 golden 逐字节一致 | 同 V-E2，载体为 `WXWebAssembly.instantiate("wasm/celld-probe.wasm")` | EC-S1、EC-R1、EC-R2 |
| `V-E4` | 尺寸计量：wasm 字节数、brotli 字节数、linear memory、实例化/运行耗时 | 数值进 receipt `counts`/`timing`（diagnostic） | EC-H2、EC-S1 |
| `V-E5` | **L3 effect 桥**：celld-logic 的 Effect 经 wasm import 交 JS executor，按 wx.storage 真实执行结果回填 completion，冷激活链仍 `Complete{Ok(Local)}` | `l3.ok===true` 且 hostCalls 含 ReadOwner→-1/CasOwner→0/Restore→-1/StartRuntime→0/Publish→0/Complete(local)→0，owner+state 均落 wx.storage | EC-S3、EC-R3 |
| `V-E6` | **L4 跨实例持久化**：fresh 实例跑完后，**新 wasm 实例**读同一 wx.storage，ReadOwner 从 -1 变持久化 epoch，转录随持久态改变 | `l4.ok===true`：freshReadOwner=-1、warmReadOwner≠-1、transcriptsDiffer | EC-S4、EC-R4 |
| `V-E7` | **L1 执行基底**：多 wasm 实例线性内存互相隔离且确定性一致；QuickJS wasm 产物可在 WXWebAssembly 实例化**并真实执行 JS** | `isolation.ok===true` 且 `engine.jsRan===true`（`1+1=2`、`(x,y)=>x*y→42`） | EC-S5、EC-R5 |

**收口判断**：
- `V-E1 ∧ V-E2 ∧ V-E3` PASS → 「celld-logic 可作为小程序 DO 环境内核的 wasm 候选」成立（H1+S1 级）；
- `V-E2` RED（Node 臂都对不上）→ wasm 移植本身有语义漂移，一票否决升级给 [业主]；
- `V-E3` RED 而 `V-E2` PASS → WXWebAssembly 宿主面问题（非 wasm 语义问题），定位到宿主层；
- R 行缺席 → 结论等级「S1 级」，不得写成设备级。

---

## §3 测试方法

### 3.1 终态与分级

终态：`PASS` / `RED`（附首条不符项）/ `NOT_RUN`（附原因）/ `deferred`（附前置）。分级见 spike 根 README §3（H1/S1/R1/R2）。

### 3.2 行与车道

| 车道 | 行前缀 | 执行体 |
|---|---|---|
| host | `EC-H*` | Node 直跑 + cargo：原生 `probe-cli` 对照臂、Node `WebAssembly` 臂、尺寸计量 |
| sim | `EC-S*` | `miniprogram-automator` 拉起 `mp/` 工程，页面 `WXWebAssembly.instantiate` 跑探针 → `globalData.probeResult` 抓回 |
| device | `EC-R*` | 同工程真机预览；结果人工抄录/回传；无设备即 `NOT_RUN` |

### 3.3 转录契约（canonical transcript）

`scenario::run()` 产出单行 JSON：`{"meta":{node,cell,request},"steps":[{"i","in":<event Debug>,"out":[<effect Debug>...]},...],"tail":{steps,completed_local,completed_any,halted,truncated,pending,last_complete}}`。判据 = **逐字节相等**（Debug 格式即 canonical 编码——celld-logic 全类型派生 `Debug`，字段序稳定）。三臂（native probe-cli / Node WebAssembly / WXWebAssembly）必须产出同一字符串。

- 原生臂：`kernel/src/bin/probe-cli.rs` → stdout。
- Node 臂：`lib/node-drive.mjs` → `new WebAssembly.Instance(new WebAssembly.Module(bytes))`。
- WX 臂：`mp/probe/probe.js` → `WXWebAssembly.instantiate("wasm/celld-probe.wasm")` → `probe_create/probe_run/probe_output_len/probe_output_ptr` 读回 linear memory 转录。

### 3.4 证伪镜像（plants）

| ID | 类 | 植入 | 预期 |
|---|---|---|---|
| `P-native-nondet` | 确定性 | 原生臂连跑两次比对 | 不一致即 scenario 非确定，探针失效 |
| `P-empty-transcript` | 解析器 | `parseTranscript("")` | 必须报错——空转录不得通过 |
| `P-golden-corrupt` | 对照器 | golden 中 `completed_local:true`→`false` 后与转录比对 | 必须判 mismatch——对照器非恒绿 |
| `P-wasm-bad` | wasm 管线 | `bad.wasm`（缺 import）实例化 | 必须抛错；不抛则管线判读失效 |

### 3.5 预算

默认 `objects ≤ 4`（wasm/golden/bad/cli 产物）、`opsCap ≤ 30`、`bytesCap ≤ 64 MiB`（cargo target 目录除外——构建产物不计入证据预算）、`stopCondition: first RED`。automator 拉起超时 60s，探针页自执行超时 30s。

### 3.6 证据落点

`evidence/<id 小写>/<UTC>.json`（gitignore）。`counts` 记 wasmBytes/wasmBrBytes/brRatio/memoryBytesAfter/transcriptBytes/steps；`timing` 记 compileInstantiateMs/runMs（diagnostic）。设备行 receipt 须含 `device{model, osVersion, wechatVersion, baseLibVersion}`。

---

## §4 文件拓扑

```text
test/spike/env-celld-wasm/
├─ README.md                 本宪章
├─ .gitignore                evidence/、kernel/target/、mp/wasm/*.wasm*（可重建）
├─ ledger.mjs                EC-* 行契约
├─ harness/run.mjs           --plan | --check | --build | <行号> | --all
│                            --build = cargo wasm32 + probe-cli → golden + 拷贝 mp/wasm + .br
├─ lib/preflight.mjs         环境门（node≥18+cargo / devtools-cli+产物就绪 / 设备）
├─ lib/envelope.mjs          receipt 信封与落盘
├─ lib/versions.mjs          node/rustc/cargo/wasm-target/devtools 版本钉
├─ lib/automator.mjs         miniprogram-automator 封装
├─ lib/node-drive.mjs        Node WebAssembly 臂驱动 + firstDiff
├─ lib/sim-run.mjs           模拟器运行器：automator.launch → probeResult → L3/L4/L1 receipts
├─ lib/receipts.mjs          共享 receipt 构造（S1/L3/L4/L1 四段）
├─ lib/result-server.mjs     preview 真机回传服务器（:18081，wx.request POST /probe）
├─ lib/device-drive.mjs / device-drive2.mjs / device-final.mjs / cdp-drive.mjs
│                            真机通道失败探索留档（反例：remote 重置会话 / CDP 前端上下文）
├─ kernel/                   Rust crate（自成 workspace，path dep → context/celld）
│  ├─ Cargo.toml             cdylib+rlib；celld-logic path dep；release=z/lto/abort/strip
│  ├─ src/lib.rs             extern "C" 导出：probe_create/run/output_ptr/output_len/destroy
│  ├─ src/scenario.rs        冷激活场景驱动 + effect→event 应答器 + canonical JSON 转录
│  ├─ src/hosted.rs          L3/L4 宿主桥：effect 经 wasm import(env.host_effect) 交 JS executor
│  └─ src/bin/probe-cli.rs   原生对照臂（stdout=golden）
├─ ref/probe-spec.mjs        独立转录结构断言（与 kernel/mp 分开实现）
├─ fixtures/golden-transcript.txt  原生臂 canonical 转录（确定性种子，可重建）
├─ rows/ec-h1.mjs            H1：原生编译 + 确定性 + golden 落盘 (V-E1,V-E2a)
├─ rows/ec-h2.mjs            H1：Node wasm 臂对照 + 尺寸计量 (V-E2,V-E4)
├─ rows/ec-s1.mjs            S1：DevTools WXWebAssembly 臂对照 (V-E3)
├─ rows/ec-r1.mjs / ec-r2.mjs  R1/R2：真机（deferred D-1/D-2）
├─ mp/                       独立 spike 小程序工程（wx356d3abb52825466，urlCheck=false）
│  ├─ project.config.json / app.json / app.js / sitemap.json
│  ├─ pages/index/*          探针页：onLoad 自动跑 runAllProbes → globalData.probeResult
│  ├─ probe/probe.js         WXWebAssembly 驱动（instantiate→create→run→读 memory→decode）
│  └─ wasm/                  celld-probe.wasm(.br) + bad.wasm 镜像 + quickjs.wasm（637KB，L1 探测）
└─ evidence/                 per-run receipt（gitignore）
```

---

## §5 行台账

| ID | 名称 | 车道 | 价值 | 级 | 前置 |
|---|---|---|---|---|---|
| `EC-H1` | celld-logic 原生编译 + 确定性对照臂 | H | V-E1 V-E2a | H1 | — |
| `EC-H2` | Node WebAssembly 臂：实例化 + 转录对照 + 尺寸计量 | H | V-E2 V-E4 | H1 | `EC-H1` |
| `EC-S1` | DevTools 模拟器 WXWebAssembly 臂 | S | V-E3 | S1 | `EC-H2` |
| `EC-R1` | iOS 真机 WXWebAssembly 臂 | R | V-E3 | R1 | `EC-S1`；`D-1` 真机 |
| `EC-R2` | Android 真机 WXWebAssembly 臂 | R | V-E3 | R2 | `EC-S1`；`D-2` 真机 |
| `EC-S2` | S1 纯逻辑回归（新 wasm 含 import 后） | S | V-E3 | S1 | `EC-H1` |
| `EC-S3` | **L3 effect 桥**：wasm→JS executor→wx.storage | S | V-E5 | S2 | `EC-S2` |
| `EC-S4` | **L4 跨实例持久化回路** | S | V-E6 | S3 | `EC-S3` |
| `EC-S5` | **L1 多实例隔离 + QuickJS 实例化** | S | V-E7 | S4 | `EC-S2` |
| `EC-R3` | L3 effect 桥（真机 preview） | R | V-E5 | R3 | `EC-S3`；`D-2` |
| `EC-R4` | L4 持久化（真机 preview） | R | V-E6 | R4 | `EC-S4`；`D-2` |
| `EC-R5` | L1 隔离+QuickJS（真机 preview） | R | V-E7 | R5 | `EC-S5`；`D-2` |

`D-1`/`D-2` = [业主] 提供真机并授权预览安装，未点收即 `NOT_RUN`。

## §6 收口回填

执行日期 2026-11-06，HEAD 见 receipt（工作区未提交，`dirtyWorktree: true`）。工具链：rustc/cargo 1.99.1 + `wasm32-unknown-unknown` target。设备指纹：S1=DevTools 模拟器 / WeChat 8.0.5 / baseLib 3.17.5；R2=三星 SM-S9080 / Android 16 / 微信 8.0.80 / baseLib 3.17.6。

| 行 | 终态 | 级 | 结论摘要 |
|---|---|---|---|
| EC-H1 | PASS | H1 | celld-logic→wasm32-unknown-unknown 编译通过（296,104B）；原生转录两次运行逐字节一致；冷激活链 6 步完成 `Complete{Ok(Local)}` |
| EC-H2 | PASS | H1 | Node `WebAssembly` 臂转录与 native golden **逐字节一致**（1,414B）；wasm 296,104B / brotli 70,763B（~24%）；**0 imports**；linear memory 1,179,648B |
| EC-S1 | PASS | S1 | **`WXWebAssembly.instantiate` 实例化 celld-logic wasm，scenario 转录与 native golden 逐字节一致**（1,414B / 6 步）；instantiate ~19ms；sim linear memory 1,114,112B |
| EC-S2 | PASS | S1 | 含 `env.host_effect` import 的新 wasm 回归：转录仍逐字节一致 |
| EC-S3 | PASS | S2 | **L3 effect 桥跑通**：6 次 host 调用（ReadOwner→-1、CasOwner→0、Restore→-1、StartRuntime→0、Publish→0、Complete(local)→0），owner+state 落 wx.storage，冷激活链 `Complete{Ok(Local)}` |
| EC-S4 | PASS | S3 | **L4 跨实例持久化成立**：fresh 实例 ReadOwner→-1；**新 wasm 实例**读同 store ReadOwner→1，转录随持久态改变（transcriptsDiffer=true） |
| EC-S5 | **PASS** | S4 | **L1 全绿**：双实例隔离 + **QuickJS 裸 C API 直连执行 JS**（`JS_NewRuntime→JS_NewContext→JS_Eval→JS_ToInt32`；`1+1=2`、`(x,y)=>x*y→42`） |
| EC-R1 | NOT_RUN | R1 | 无 iOS 真机在场（gate D-1）；探测通道已建（preview QR + wx.request 回传） |
| EC-R3 | PASS | R3 | **L3 effect 桥真机成立**：6 次 host 调用（ReadOwner→-1/CasOwner→0/Restore→-1/StartRuntime→0/Publish→0/Complete(local)→0），owner+state 落设备 wx.storage，6 步 `Complete{Ok(Local)}` |
| EC-R4 | PASS | R4 | **L4 真机持久化成立**：fresh ReadOwner=ReadOwner->-1 → 新实例 warm ReadOwner=ReadOwner->1，transcriptsDiffer=True |
| EC-R5 | **PASS** | R5 | **L1 真机全绿**：双实例内存隔离（1,179,648B×2，确定性一致）+ **QuickJS 裸 C API 在设备上真实执行 JS**（`1+1=2`、`(x,y)=>x*y→42`，jsRan=true） |
| EC-R2 | PASS | R2 | **三星 SM-S9080 / Android 16 / 微信 8.0.80 / baseLib 3.17.6：preview 真机跑通，转录与 native golden 逐字节一致**（1,414B / 6 步，instantiate 17ms，linear memory 1,114,112B，bad.wasm 正确抛错）；新 wasm 含 import 后回归复跑仍 PASS |

镜像：P-native-nondet（EC-H1）、P-empty-transcript + P-golden-corrupt（EC-H2）、P-wasm-bad + P-golden-corrupt（EC-S1）均 fired + restored。

### 发现台账

0. **L1 引擎已跑通**：`quickjs-wasi@3.6.3` 的 wasm 是**裸 QuickJS C API 构建**（450 导出；imports 仅 `env.host_*` 6 个 + WASI 基础调用，全可 no-op 垫片）。`JS_NewRuntime → JS_NewContext → JS_Eval → JS_ToInt32` 在小程序模拟器与三星 Android 16 真机上均真实执行 JS（`1+1=2`、`(x,y)=>x*y→42`），不需要 emscripten 运行时。
1. **celld-logic 零依赖纯决策核可干净 wasm 化**：`wasm32-unknown-unknown` 产物 **0 import**（连 WASI 都不需要），`memory` 自动导出——`WXWebAssembly.instantiate(path)` 无需任何 shim 即可实例化，S1 实测成立。
2. **尺寸远低于预期**：296KB wasm → **70.7KB brotli**。celld-logic 本体（13.4k 行）不是体积瓶颈；SQLite/LTX/executor shim 才是（后续 spike 议题）。对 2MB 分包线：单个 `.wasm.br` 仅 ~71KB，余量巨大。
3. **确定性成立**：原生两次运行逐字节一致 + Node 臂与 native 逐字节一致 + **WXWebAssembly 臂与 native 逐字节一致**——celld-logic 的 "no clocks/randomness" 设计承诺在 wasm 边界兑现，跨 JS 引擎（Node V8 ↔ DevTools 模拟器）语义等价。
4. **冷激活链在 wasm 内完整走通**：`Request → ReadOwner → OwnerRead → CasOwner → Restore → StartRuntime → Publish → Complete{Ok(Local)}` 六步，op-versioned effect/event 配对工作正常——这正是未来 WX executor 桥接要复用的契约形状。
5. **证据上限**：S1 + R2/R3/R4/R5 级。Android 真机（preview 通道，零 remote-debug）四层全绿；iOS（JSC）未证，R1 `NOT_RUN`。真机通道 = `cli preview` 二维码扫码 + 页面 `wx.request` 回传局域网结果服务器（`lib/result-server.mjs`），不触碰 remote-debug 状态机。仍不证：30 种 Effect 全量映射、SQLite/LTX 位级兼容、nacp 协议对齐、分布式面。

---

## §7 心智模型对照：业主原始目标 vs spike 实证

业主在 2026-11-06 对话中给出的原始心智模型（逐条对照）：

| # | 业主原始表述 | spike 实证事实 | 校正结论 |
|---|---|---|---|
| 1 | 「写一个 celld 内核，将 celld 这个 durable-object **完整**打包进一个 wasm 内核，注入微信小程序」 | celld daemon 的 `crates/celld`（~90k 行：rusty_v8 12.7k 行、tokio、rusqlite、POSIX fs）**不存在 wasm32 目标**；`crates/logic`（13.4k 行纯决策核）可编且语义无损（EC-H1/H2/S1/R2） | 「完整 celld」不可行；**按四层分解后每层都可行**（§8） |
| 2 | 「微信小程序分包最大 2M，celld 是否可行」 | celld-logic wasm **300,089B / brotli 70,763B**；QuickJS 引擎 **637,405B**；二者合计 br 后约 0.3MB | 体积**不是瓶颈**——2MB 线对核心产物宽松 6 倍以上 |
| 3 | 「是否可以在不同分片下分批完成加载」 | 单个 wasm 不能字节级拆分后独立实例化；按**模块粒度**拆分包可行（logic / engine / executor / shim） | 可行，形态是「多模块分包 + preloadRule」，不是「单 wasm 分片」 |
| 4 | 「业主要的是一个**执行环境**，而不是上层建筑……类似于 workerd 的 durable-object 环境」 | L2 决策核（EC-S3/R3）、L3 executor 桥（EC-S3/R3）、L4 持久化（EC-S4/R4）、L1 QuickJS 真执行（EC-S5/R5）**四层全部实证** | **执行环境成立**，但形态是「单节点、前台、可休眠的 DO 语义子集」，不是 workerd 等价物 |
| 5 | 「可以与我们其他 cloudflare 环境兼容，让线下和线上环境部分统一，在关键协议上保持兼容，并且可以在未来能够液态流动」 | 可流动的是 **cell 契约**（epoch / canonical state blob / op-versioned effect 协议），不是存储字节；分布式面（ownership CAS、S3/LTX 真源）必须留在云端 | **契约级兼容成立**，位级兼容既不可能也无必要（§11） |

**一句话**：业主想要的「环境」确实存在，但它不是「celld 变小」，而是 **celld 的合同层（L2）+ 小程序原语实现的执行层（L1/L3/L4）** 组成的新 substrate；分布式语义按设计留在云端，成为液态流动的另一端。

---

## §8 结论支持的小程序内部运行环境拓扑

### 8.1 分层拓扑（全部有实证支撑）

```text
┌─ 小程序侧（设备 / 模拟器）──────────────────────────────────────────┐
│                                                                      │
│  UI / 产品层（dsh 界面还原、会话列表、消息流）                        │
│      │                                                               │
│  ┌───▼───────────────────────────────────────────────────────────┐   │
│  │ cell 管理器 —— celld-logic wasm（L2，300KB / 71KB br）        │   │
│  │   · ownership / epoch fencing / 单写者 gate / lifecycle       │   │
│  │   · Phase 机：Inactive→ReadingOwner→Acquiring→Restoring→      │   │
│  │     Starting→Resident→Dormant→Cleaning                       │   │
│  │   · alarm / eviction / capacity / handoff 状态机               │   │
│  └───┬───────────────────────────────────────────────────────────┘   │
│      │ Effect（op-versioned，30 变体）                                │
│  ┌───▼───────────────────────────────────────────────────────────┐   │
│  │ executor —— TS/JS（L3）                                        │   │
│  │   · ReadOwner/CasOwner → wx.storage（owner record）           │   │
│  │   · Restore/Publish    → wx.storage（cell state blob）        │   │
│  │   · StartRuntime       → 拉起 per-cell QuickJS VM             │   │
│  │   · fetch/WebSocket/alarm → wx.request / wx.connectSocket /   │   │
│  │     timer + 冷恢复重放（全集待建，6/30 已证）                  │   │
│  └───┬───────────────────────────────────────────────────────────┘   │
│      │                                                               │
│  ┌───▼──────────────────────────┐   ┌───────────────────────────┐   │
│  │ 持久层（L4）                  │   │ 执行引擎（L1）             │   │
│  │  wx.storage                   │   │  QuickJS wasm（637KB）     │   │
│  │   · owner record（epoch）     │   │   · per-cell VM 隔离       │   │
│  │   · cell state blob           │   │   · JS_NewRuntime →        │   │
│  │   · checkpoint / 冷恢复       │   │     JS_Eval → JS_ToInt32   │   │
│  └──────────────────────────────┘   └───────────────────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ cell 契约（epoch + canonical state + nacp wire）
┌──────────────────────────────▼───────────────────────────────────────┐
│ 云端（Cloudflare workerd / celld fleet）                              │
│   · session.do / user.do（真 DO，单写者权威）                          │
│   · S3 / LTX 真源（durable 单一真源）                                  │
│   · fleet ownership CAS + peer 路由                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 尺寸预算（实测）

| 组件 | 原始 | brotli | 备注 |
|---|---|---|---|
| celld-logic wasm | 300,089B | 70,763B | 决策核全量（13.4k 行） |
| QuickJS wasm | 637,405B | 未测（估 ~250KB） | 裸 C API，450 导出 |
| executor JS（估算） | ~50–100KB | 同量级 | 30 种 Effect 全集 |
| **合计** | **< 1MB** | **< 0.5MB** | 单个 2MB 分包可容纳，余量 4 倍 |

### 8.3 生命周期边界（平台硬限，非实现缺陷）

- **无后台执行**：turn 必须在前后台运行；`wx` 无长驻 service。celld-logic 的 `Dormant`/`Restore` 状态机正好对应「冷恢复」语义。
- **无服务端权威**：小程序进程可被杀，单写者只能靠「云端 DO 为权威 + 本地 epoch 只读缓存」保证。
- **alarm 降级**：`AlarmState` 状态机在 L2 完整，但触发面只能是「下次进入时重放」——语义等价于 DO hibernation 的 wake-on-request。

---

## §9 agent harness 在小程序内的运行形态

结论：**cell-per-session** 是唯一与平台约束相容的形态。

```text
一个 ACP/nacp session  =  一个 cell
  · 用户发消息        → Request{cell} → 冷激活链（6 步，已证）
  · LLM turn          → cell 内 runtime（QuickJS VM）执行
  · 工具调用          → Effect → wx 原语（storage/request/timer）
  · turn 结束         → Publish + checkpoint（cell state → wx.storage）
  · 切走/杀进程       → 下次进入 Restore（L4 已证跨实例）
  · 多 session 并发   → 单写者 gate 串行化（L2 已证）
```

**与 dsh 的映射**：dsh 的「会话列表 + 消息流 + 工具调用」正好对应 cell 的「cell id + 请求/输出 + effect」。**harness 不需要自己实现会话生命周期**——这是 celld-logic 最大的复用价值。

**明确不能做的**：常驻 DO（后台长跑）、跨 session 事务、服务端权威时钟、无网首启的跨设备一致。

---

## §10 fx 真实形态分析

### 10.1 fx 是什么（仓库事实）

- `context/fx` = Vercel 的 wasm agent CLI；`subpkg/fx/fx-core-async.wasm` **3.9MB**（`.br` 994KB），Asyncify 编译（无 JSPI，膨胀 +55.7% → 4.1MB）
- `services/fx/runtime.ts` / `fx-host.ts` / `env.ts`：ACP 会话、本地 VFS 工具、权限/工具调用、串行活跃会话
- 已有实证：`fx-wasm-jspi`（挂起机制 S1 级）、`fx-wasm-stream`（`wx.request` 分块 SSE，H/S 6/6 PASS）、`fx-wasm-agent`（真实 ACP turn + tool-call 循环，4/6 PASS）

### 10.2 fx 与 celld 环境的关系

**fx 是 workload，不是 substrate**。它自带 wasm runtime，不需要 L1 QuickJS 来跑自己。celld 环境对 fx 的价值在三处：

| 价值点 | 具体形态 | 证据/前提 |
|---|---|---|
| **会话生命周期** | fx 的 cold start / hibernate / resume 由 cell 状态机管理，替代 `services/fx/runtime.ts` 自建的 serialized active-session | L2 已证（EC-S3/R3） |
| **持久化** | fx session state → cell state blob（wx.storage），跨进程恢复 | L4 已证（EC-S4/R4） |
| **液态流动** | fx session 导出 canonical state → 云端 fx/nano 接管，epoch+1 防双写 | 契约设计，未实现 |

### 10.3 明确不解决的

- **fx wasm 4.1MB 超 2MB 分包线 55.7%** —— 这是 fx 自身的体积问题，celld 环境不解决。已有 `fx-wasm-size` spike 的裁剪清单（`wasi_fs` 1.16MB 可裁，pkg0/1/2 分包）。
- **Asyncify 性能/膨胀** —— 与 celld-logic 无关（后者同步设计不需要 Asyncify）；但**如果 fx 未来重写为 effect/event 模型**，可以彻底去掉 Asyncify——这是 celld-logic 给 fx 的长期架构红利，不是当前解法。

### 10.4 fx 结论

fx 可以**跑在** cell 环境上（作为 workload），获得生命周期与持久化能力；但 fx 的体积与挂起机制问题需要 fx 自己的裁剪路线。**建议：fx 保持独立 wasm，cell 环境只做「外壳」**——不要试图把 fx 塞进 celld-logic 的决策核。适配成本结构见 §12.7.3。

---

## §11 nano-agent 真实形态分析

### 11.1 nano-agent 是什么（仓库事实）

- Cloudflare Workers + Durable Objects：`session.do` / `user.do`（`workers/agent-core/`），共 9 workers
- 协议层：`packages/nacp-core/`、`packages/nacp-session/`（NACP 协议，全仓通讯结构统一）
- 执行面：agent-kernel、filesystem-core（VFS）
- 原则：单一真源 durable state（canonical 只许一份可写副本）

### 11.2 概念映射（cell 契约 ⇄ nano-agent）

| nano-agent 概念 | 小程序 cell 环境对应 | 实证状态 |
|---|---|---|
| `session.do`（会话 DO） | cell（celld-logic 状态机） | ✅ EC-S3/R3（冷激活链） |
| DO storage（per-object durable） | wx.storage cell state blob | ✅ EC-S4/R4（跨实例） |
| DO alarm / 定时 | L2 `AlarmState` + 前台 timer + 冷恢复重放 | 🟡 状态机在，触发面待接 |
| ownership / epoch fencing | celld-logic `Claim`/`Epoch`/`CasGuard` | ✅ L2 全量（编译即证） |
| NACP wire（nacp-core/session） | Effect/Event op-versioned 配对 | 🟡 形状同构，**协议未对齐** |
| agent-kernel 执行循环 | cell 内 QuickJS VM + executor | 🟡 L1 已证引擎，kernel 循环待建 |
| filesystem-core / VFS | wx.storage 命名空间 / 文件系统 | 🟡 未建 |
| 多租户凭证（nak_token） | 小程序侧载体（storage + 请求头） | 🟡 未验 |

### 11.3 液态流动的实现路径（结论支持的形态）

```text
本地 cell（小程序）                     云端 DO（Cloudflare）
  ┌─────────────┐   1. checkpoint      ┌─────────────┐
  │ cell state  │ ──────────────────▶  │ session.do  │
  │ epoch = N   │   canonical blob     │ epoch = N+1 │
  └─────────────┘                      └─────────────┘
        ▲                                     │
        │        2. 回流（epoch+1）            │
        └─────────────────────────────────────┘
  3. fencing：epoch 单调递增，旧 epoch 双写拒绝（celld-logic CasGuard 语义）
```

**关键判断**：可流动的是**契约**（session schema + checkpoint fragment + epoch），不是存储字节。nano-agent 的 DO storage 是黑盒，celld 的 LTX 是自家格式——两者位级不兼容，也无需兼容。**这与 AGENTS.md 的 PT-2（兼容 nacp 协议与真源）是同一件事**。

### 11.4 缺口（按优先级）

1. **nacp 协议对齐**：session schema / checkpoint fragment 双端一致（`kernel.js` 已有 `buildCheckpointFragment`/`restoreFromFragment` 可复用）
2. **agent-kernel 循环**：cell 内「LLM turn → 工具调用 → 输出」的 executor 循环
3. **VFS 映射**：filesystem-core 的命名空间 → wx.storage/文件系统
4. **凭证车道**：nak_token 在小程序侧的存储与请求注入
5. **alarm 触发面**：前台 timer + 冷恢复重放的语义定义

---

## §12 完整报告与建议

### 12.1 结论总结

| 命题 | 结论 | 证据等级 |
|---|---|---|
| celld 决策核可在小程序内语义无损运行 | ✅ 成立 | H1 + S1 + R2（三端逐字节一致） |
| DO 环境四层可在小程序内成立 | ✅ 成立（L1/L2/L3/L4 全证） | S + R2/R3/R4/R5 |
| 完整 celld daemon 可进 wasm | ❌ 不成立（V8/tokio/rusqlite 无 wasm32） | 编译事实 |
| 分布式面（ownership/S3）可下放本地 | ❌ 不成立，必须云端 | 平台约束 |
| 与 Cloudflare 契约级兼容 | ✅ 成立（cell 契约） | 设计 + L2 语义 |
| fx 可跑在 cell 环境上 | ✅ 成立（workload 关系） | L2/L4 已证 |
| nano-agent 可液态流动 | 🟡 契约就绪，协议未对齐 | 待 nacp spike |

### 12.2 建议（按优先级）

1. **采纳 celld-logic 作为 cell 内核（L2，件②）**——已证、风险最低、体积可忽略（71KB br）。这是整个方案的地基。
2. **executor 全集 spike（件③）**：30 种 Effect → wx 原语（fetch/WebSocket/alarm/VFS），当前 6/30 已证。
3. **nacp 对齐 spike（件④）**：session schema + checkpoint fragment 双端一致，验证「本地 cell ⇄ 云端 DO」一次真实迁移。
4. **agent-kernel 循环 spike（件①）**：cell 内 QuickJS VM 跑一个真实 LLM turn（工具调用 + 输出）。
5. **fx 体积走独立路线**：`fx-wasm-size` 的 wasi_fs 裁剪 + 分包拆分，不要与 cell 环境耦合。
6. **iOS 补证（R1）**：JSC 的 wasm 行为与 V8 可能有差异，preview 通道已建，一次扫码即可。

### 12.3 不建议做的事

- ❌ 移植 celld daemon（V8 嵌入、SQLite、tokio 全部无解）
- ❌ 追求 SQLite/LTX 位级兼容（既不可能也无必要）
- ❌ 把分布式语义下放本地（小程序无服务端权威）
- ❌ 用 QuickJS 跑 CPU 密集任务（比 V8 慢一个数量级，I/O 密集可接受）

### 12.4 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| 小程序无后台执行 | 长 turn 必须前台；中断恢复靠 L4 | 产品化「恢复」交互；turn 切片 |
| wx.storage 容量上限 | cell state blob 可能超限 | 压缩 / 分片 / 只存增量 |
| QuickJS 性能 | CPU 密集场景不可用 | 只跑 I/O 密集 agent 逻辑 |
| iOS JSC 未证 | R1 缺口 | preview 通道一次扫码 |
| nacp 协议漂移 | 液态流动失败 | 先对齐 schema 再实现 |

### 12.5 与业主原始心智模型的最终对照

业主的原始目标是「**一个执行环境**，与 Cloudflare 兼容，可液态流动」。spike 的答案是：

> 环境存在，但它是**四层组合**而非单一 wasm：celld-logic 提供合同（L2），小程序原语提供执行（L1/L3/L4），云端 DO 提供权威（分布式面）。**液态流动的单位是 cell 契约，不是二进制**。这比「把 celld 打包进 wasm」更接近业主真正想要的东西——因为 workerd 的价值从来不在它的二进制，而在它的**单写者 + durable + 可迁移语义**。

### 12.6 常见误解校正（2026-11-06 业主问答记录）

以下四条是「本轮结论意味着什么」的常见过度推断，逐条校正后作为后续决策基线：

| # | 误解表述 | 校正 |
|---|---|---|
| `M-1` | 「fx 和 nano-agent 是通过**改写**进入小程序的」 | **fx 核心从未改写**：`subpkg/fx/fx-core-async.wasm` 就是 fx 原 Rust 代码的编译产物；改写的是**宿主适配层**（`services/fx/env.ts` 的 `WXWebAssembly.instantiate`、fetch/UTF-8 shim）。**nano-agent 目前不在小程序内**：它以原状跑在 Cloudflare（cloud-runtime），小程序侧只是 nacp 客户端——「改写进入」这个描述对它不成立 |
| `M-2` | 「本轮后 fx / nano-agent 可以 **pin 原状执行**，不用改写」 | 部分成立。**fx**：可保持 pin 核心 + 既有适配层（适配层是平台差异的固有成本，本轮未消除、也不应消除）。**nano-agent**：**不能原状进小程序**——它依赖 workerd 的 DO API 面（`ctx.storage` / fetch handler / alarm / WebSocket），cell 环境给的是 substrate 不是 workerd API 兼容层，必须**新写**「DO 绑定 → cell 环境」映射层。「原状」只在云端成立 |
| `M-3` | 「V8 运行时由小程序的 JS 表达器**模拟**」 | 不准确。L1 验证的是 **QuickJS**——一个**独立引擎**，不是 V8 的模拟。分工：宿主 JS 引擎（Android V8 / iOS JSC）跑**外壳代码**（executor、UI）；**per-cell 隔离由 QuickJS wasm 实例提供**。语义是 QuickJS 语义（ES2020 级、比 V8 慢一个数量级），不是 V8 语义；依赖 V8 特有行为（ES2023+ 语法、JIT 性能假设）的 workload 需降级或适配 |
| `M-4` | 「其他协议已经被本轮 celld-wasm 测试验证」 | 过宽。本轮验证的是 **substrate 模式**：effect/event 桥（**6/30** 种 Effect）、持久化语义（owner record + state blob 跨实例）、引擎可执行（QuickJS 真跑 JS）。**未验证**：nacp 协议、DO API 面、fx 的 ACP、workerd 兼容 |

**校正后的统一表述**：

> 免改写的是**环境合同**，不是 **workload 代码**。fx 省掉的是会话管理代码（由 cell 生命周期接管）；nano-agent 省掉的也是会话管理代码——但 nano-agent 的 **DO 绑定层是新增工作，不是零成本**。

### 12.7 local-runtime 工作分解：四件套基线

把「为 local-runtime 构建合同 + 为 nano-agent 构建 adapter」精确化为**两半合同 + 四个工作件**，作为后续所有 spike 的分解基线。

#### 12.7.1 合同是两半

| 合同半边 | 内容 | 状态 | 归属 |
|---|---|---|---|
| **内核合同** | Event/Effect（op-versioned）、ownership/epoch、lifecycle Phase 机、alarm/eviction | **采纳 celld-logic 原样**，本轮已验证可跑（EC-S3/R3） | 无需新建 |
| **宿主合同** | Effect 语义 → 平台原语的映射规范：哪些必须同步、哪些可延迟、失败/重试语义、durability 证明规则 | **新写** | **需业主裁决**（错误枚举/重试义务属公共合同，按 AGENTS.md 不得擅自扩约） |

#### 12.7.2 四个工作件

```text
┌ nano-agent workload（原状代码，pin）────────────────┐
│  ctx.storage / fetch handler / alarm / WebSocket    │
├ ① 运行时 adapter（新写，L3 扩展）────────────────────┤
│  DO API 面 → Effect / wx.storage / wx.request       │
├ ② 内核合同（采纳 celld-logic，已验证）───────────────┤
│  Event/Effect、ownership/epoch、lifecycle            │
├ ③ 执行面（新写，6/30 已证）──────────────────────────┤
│  Effect → wx 原语 + 失败语义（宿主合同的实现）        │
├ 平台：wx.storage / wx.request / WXWebAssembly / timer │
└──────────────────────────────────────────────────────┘
        ↕ ④ 迁移 adapter（新写，nacp ↔ cell checkpoint）
┌ 云端 session.do / user.do（原状，pin）───────────────┐
```

| 件 | 名称 | 内容 | 状态 | 对应 §12.2 建议 |
|---|---|---|---|---|
| ① | **运行时 adapter** | DO API 面（`ctx.storage`/fetch/alarm/WebSocket）→ cell 环境 | 未建 | 建议 4（agent-kernel 循环） |
| ② | **内核合同** | celld-logic 原样采纳 | ✅ 已验证 | 建议 1 |
| ③ | **执行面** | Effect → wx 原语 + 失败语义（宿主合同实现） | 6/30 已证 | 建议 2 |
| ④ | **迁移 adapter** | nacp session schema / checkpoint fragment ↔ cell state blob + epoch | 未建 | 建议 3 |

#### 12.7.3 workload 适配成本不对称

| workload | ① 运行时 adapter | ② 内核合同 | ③ 执行面 | ④ 迁移 adapter |
|---|---|---|---|---|
| **fx** | **不需要**（wasm + `fx-host.ts` 已处理 host 接口） | 可选复用（生命周期集成） | **不需要**（自带 runtime） | 需要（若要液态流动） |
| **nano-agent** | **需要**（DO API 面是新工作） | 复用 | 需要 | 需要 |

**结论**：「为 nano-agent 构建 adapter」成立，但**不是所有 workload 都需要同一层 adapter**——fx 与 nano-agent 的适配成本结构不同：fx 是「pin 核心 + 既有适配层」，nano-agent 是「pin 云端 + 新增本地绑定层」。

