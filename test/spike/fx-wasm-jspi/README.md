# test/spike/fx-wasm-jspi — fx WASM 挂起机制在微信 JS 引擎上的取证宪章

> **一句话定义**：回答「fx `fx-core.wasm` 依赖的 JSPI 挂起机制，在小程序的 `WXWebAssembly` / 宿主 JS 引擎上是否存在；若缺席，binaryen Asyncify 变换能否作为等价挂起路径」。本目录只产证据，不改公共合同，不施工产品代码。

| 锚 | 值 |
|---|---|
| 建档日期 | 2026-11-03 |
| HEAD | `9ee4c28`（脚手架唯一提交；全部移植工作为未提交工作树状态） |
| 上游真相 | `context/fx/sdk/wasm-runtime.js:882-963`（~20 个宿主 import 经 `WebAssembly.Suspending` 包装，含 `fx_http_request`/`fx_http_stream_*`/`fx_host_tool_call`/`fx_session_*`/`fx_config_*`）；`context/fx/sdk/wasm-runtime.js:1018-1023`（`supportsJspi()` 不存在即抛 `fx WebAssembly requires JSPI`；入口 `WebAssembly.promising(instance.exports._start)`）；`context/fx/sdk/engine.js:652-653`（`supportsJspi()` = `typeof WebAssembly.Suspending === "function" && typeof WebAssembly.promising === "function"`）；`node_modules/miniprogram-api-typings/types/wx/lib.wx.wasm.d.ts`（WXWebAssembly 类型面：仅 `instantiate(path)`/`Module`/`Instance`/`Memory`/`Table`，**类型面即无 `Suspending`/`promising`**） |
| 组织先例 | `context/nano-agent/test/spike/`（neo）；dsh-mini `test/spike/README.md` |
| 环境 | 本机 macOS Node v22.22.0（H1）；微信开发者工具（S1，`/Applications/wechatwebdevtools.app`）；真机 iOS / Android（R1/R2，需 [业主] 设备） |
| 证据上限 | S1 结论不覆盖真机；R1/R2 缺席时相关行记 `NOT_RUN`，不得由 S1 推断 |
| 判读口径 | 2MB 与「可用」的判据写死在下文 §3，跑完不挪 |

**边界声明**：不改 `context/fx` 源码；不在 spike 内构建 fx wasm（那是 `fx-wasm-size` 的事）；spike 小程序工程 `mp/` 用 `touristappid`，与产品 AppID `wx356d3abb52825466` 隔离；不产生 provider 调用；本目录结论被 [业主] 登记后可整体删除。

---

## §0 代码现实初步分析

建档时可复核事实（非行为 PASS）：

- **fx 的挂起面集中在 import 层**：`wasm-runtime.js` 把全部异步宿主 import（http、session、config、tool、prompt history、oauth、workspace exec、剪贴板、open_url）包成 `WebAssembly.Suspending(fn)`，wasm 侧 `_start` 经 `WebAssembly.promising` 调用。含义：**改造点 = import 面挂起机制**，与 fx 业务逻辑无关——Asyncify 若成立，等价路径存在。
- **Node 22.22.0 宿主实测（建档时）**：`WebAssembly.Suspending`/`promising`/`Function.promising` 均 `undefined`，`--experimental-wasm-jspi` + `--experimental-wasm-stack-switching` 双旗亦未暴露（V8 有 flag、无 JS 绑定）。即 **H1 环境无法跑 JSPI 正臂**，只能跑缺席探测与 Asyncify 替代臂。此事实本身记为发现 `F-01`。
- **WXWebAssembly 类型面无 JSPI**：`lib.wx.wasm.d.ts` 无 `Suspending`/`promising`/`Global`/`instantiate(bufferSource)`（仅 path 形式与 `new Module(bytes)`）。JS 绑定缺席与否须实测，类型面只是线索。
- **Asyncify 工具链就绪**：`binaryen@132` `runPasses(['asyncify'])` 对 toy 模块生效（建档时 smoke 通过，451B 输出）。

### 0.5 发现台账

| ID | 发现 | 处置 |
|---|---|---|
| `F-01` | 本机 Node 22.22.0 无 JSPI JS 绑定（双旗无效），H1 无法跑 JSPI 正臂 | 记为环境事实；JSPI 正臂只留 S1/R1/R2 车道探测；Asyncify 臂由 JW-H2 在 H1 承担 |

---

## §1 本目录回答什么

1. 各环境（H1 / S1 / R1 / R2）的宿主 JS 引擎是否暴露 `WebAssembly.Suspending` / `WebAssembly.promising`（JSPI 正臂探测）。
2. `WXWebAssembly` 能否实例化并执行一个普通 wasm（控制臂：证明 wasm 管线本身可用，把「JSPI 缺席」与「wasm 整体不可用」区分开）。
3. binaryen Asyncify 变换后的 toy 模块（import 异步宿主函数 → export 计算两次调用结果），在各环境能否完成 suspend/resume 且保持中间状态（Asyncify 替代臂）。
4. 上述结论合起来能否支撑「fx wasm 改造路径 = Asyncify」这一设计前提成立或否决。

本目录不回答：fx-core.wasm 实际改造工作量、体积（`fx-wasm-size` 的事）、BYOK 域名策略（合同项）、Asyncify 在长会话下的性能（待 [业主] 决定是否追加测量行）。

---

## §2 价值台账（`V-J*`）

| ID | 待证价值 | 判据（写死） | 承接行 |
|---|---|---|---|
| `V-J1` | 各环境 JSPI API 面实测：`WebAssembly.Suspending`/`promising` 存在与否 | 逐项 `typeof` 实测值进 receipt；不存在记事实，不判产品红 | JW-H1、JW-S1、JW-R1、JW-R2 |
| `V-J2` | 普通 wasm 在 `WXWebAssembly` 可实例化、导出函数可调用（控制臂） | `instantiate('wasm/echo.wasm')` 成功且 `echo()` 返回 `0x2A` | JW-S1、JW-R1、JW-R2 |
| `V-J3` | Asyncify 变换 toy 在本机 Node 完成两次异步宿主往返且状态保持 | `run()` 返回 `first + second = 7 + 35 = 42`；两次 suspend 各自恢复；`memory` 中计数器=2 | JW-H2 |
| `V-J4` | 同一 Asyncify toy 在 DevTools 模拟器内（`WXWebAssembly` + JS 驱动）同判据成立 | 同 V-J3 | JW-S2 |
| `V-J5` | 同一 Asyncify toy 在真机 iOS/Android 同判据成立 | 同 V-J3 | JW-R1、JW-R2 |

**收口判断**：
- `V-J3` ∧ `V-J4` PASS → 「Asyncify 是可行挂起路径」成立（H1+S1 双环境）；
- `V-J1` 在任一环境实测 JSPI 存在 → 该环境可直接用 fx 原版 wasm（事实登记，非否决 Asyncify）；
- `V-J2` RED → wasm 整体不可用，fx-wasm 路线整体重估（一票否决升级给 [业主]）；
- R 行缺席 → 记 `NOT_RUN`，结论等级标「S1 级」，不得写成设备级。

---

## §3 测试方法

### 3.1 终态与分级

终态：`PASS` / `RED`（附首条不符项）/ `NOT_RUN`（附原因）/ `deferred`（附前置）。分级见总 README §3（H1/S1/R1/R2）。

### 3.2 行与车道

| 车道 | 行前缀 | 执行体 |
|---|---|---|
| host | `JW-H*` | Node 直跑，wabt/binaryen 生成 toy wasm，Asyncify JS 驱动 |
| sim | `JW-S*` | `miniprogram-automator` 拉起 `mp/` 工程，页面探针跑完写 `globalData.probeResult`，automator `evaluate` 抓回 |
| device | `JW-R*` | 同工程真机预览；结果经页面展示人工抄录或回传；无设备即 `NOT_RUN` |

### 3.3 toy wasm 契约（fixtures）

- `echo.wat`：`export echo() -> i32.const 0x2A` —— 纯控制臂，证明 wasm 管线可用。
- `async-toy.wat`：import `env.host_read() -> i32`（异步宿主函数，JS 侧 sleep 后返回序列值），export `run() -> i32` 连续两次 `call $host_read` 求和、并把调用次数写入 memory[0]。经 `binaryen asyncify` 变换后由 JS Asyncify 驱动执行。
- 镜像 `bad.wat`：语法合法但 import `env.missing` 未提供 —— instantiate 必须抛 `LinkError`，证明探针会红。

### 3.4 证伪镜像（plants）

| ID | 类 | 植入 | 预期 |
|---|---|---|---|
| `P-jspi-null` | 探针自检 | 对 `WXWebAssembly.promising` 恒存在的假探针路径喂入缺席环境 | 假探针判 PASS 即为探针失效证据；行内以缺席值断言镜像 RED |
| `P-wasm-bad` | wasm 管线 | `bad.wasm`（缺 import）实例化 | 必须抛错；不抛则管线判读失效 |
| `P-async-sync` | Asyncify | host_read 改为同步返回且不调 asyncify_get | `run()` 结果应为 0/错值或驱动超时——证明 suspend 真发生了 |

### 3.5 预算

默认 `objects ≤ 10`（toy wasm 文件数）、`opsCap ≤ 40`、`bytesCap ≤ 4 MiB`、`stopCondition: first RED`。automator 拉起超时 60s，探针页自执行超时 30s。

### 3.6 证据落点

`evidence/<id 小写>/<UTC>.json`（gitignore）。设备行 receipt 须含 `device{model, osVersion, wechatVersion, baseLibVersion}`（真机时从 `wx.getDeviceInfo`/`wx.getAppBaseInfo` 抓）。

---

## §4 文件拓扑

```text
test/spike/fx-wasm-jspi/
├─ README.md                 本宪章
├─ .gitignore                evidence/、mp/wasm/*.wasm（可重建）
├─ ledger.mjs                JW-* 行契约
├─ harness/run.mjs           --plan | --check | --build | <行号> | --all
├─ lib/preflight.mjs         环境门（node/devtools/设备）
├─ lib/envelope.mjs          receipt 信封与落盘
├─ lib/versions.mjs          node/devtools/baseLib 版本钉
├─ lib/wat.mjs               wabt wat→wasm + binaryen asyncify 变换
├─ lib/asyncify.mjs          Asyncify JS 驱动（H 与 mp 共用同一实现形状）
├─ lib/automator.mjs         miniprogram-automator 封装
├─ fixtures/echo.wat         控制臂 wasm 源
├─ fixtures/async-toy.wat    Asyncify 被测模块源
├─ fixtures/bad.wat          镜像：缺 import 模块源
├─ ref/probe-spec.mjs        独立探针清单（与 mp/probe 分开实现，对拍用）
├─ rows/jw-h1.mjs            H1：宿主 JSPI API 面探测
├─ rows/jw-h2.mjs            H1：Asyncify toy 往返（V-J3）
├─ rows/jw-s1.mjs            S1：DevTools API 面 + echo 控制臂（V-J1/V-J2）
├─ rows/jw-s2.mjs            S1：DevTools 内 Asyncify toy（V-J4）
├─ rows/jw-r1.mjs            R1：iOS 真机（V-J1/V-J2/V-J5）
├─ rows/jw-r2.mjs            R2：Android 真机（V-J1/V-J2/V-J5）
├─ mp/                       独立 spike 小程序工程（touristappid）
│  ├─ project.config.json    urlCheck=false；与产品 AppID 隔离
│  ├─ app.json / app.js
│  ├─ pages/index/*          探针页：onLoad 自动跑全部探针→globalData.probeResult
│  ├─ probe/probe.js         探针实现（API 面/echo/asyncify）
│  └─ wasm/                  --build 生成的 *.wasm（gitignore）
└─ evidence/                 per-run receipt（gitignore）
```

---

## §5 行台账

| ID | 名称 | 车道 | 价值 | 级 | 前置 |
|---|---|---|---|---|---|
| `JW-H1` | 宿主 JSPI API 面探测 | H | V-J1 | H1 | — |
| `JW-H2` | Asyncify toy 两次异步往返 | H | V-J3 | H1 | `JW-H1` |
| `JW-S1` | DevTools API 面 + echo 控制臂 | S | V-J1 V-J2 | S1 | `JW-H1` |
| `JW-S2` | DevTools Asyncify toy | S | V-J4 | S1 | `JW-H2` `JW-S1` |
| `JW-R1` | iOS 真机全套探针 | R | V-J1 V-J2 V-J5 | R1 | `JW-S2`；`D-1` 真机 |
| `JW-R2` | Android 真机全套探针 | R | V-J1 V-J2 V-J5 | R2 | `JW-S2`；`D-2` 真机 |

`D-1`/`D-2` = [业主] 提供真机并授权预览安装，未点收即 `NOT_RUN`。

## §6 收口回填

执行日期 2026-11-03，HEAD `9ee4c28`（工作区未提交，receipt `dirtyWorktree: true`）。设备指纹（S1）：DevTools 模拟器 iPhone 17 / iOS 10.0.1 / WeChat 8.0.5 / baseLib 3.17.5。

| 行 | 终态 | 级 | 结论摘要 |
|---|---|---|---|
| JW-H1 | PASS | H1 | Node 22 无 JSPI JS 绑定（`--experimental-wasm-jspi` 亦不暴露 `Suspending`/`promising`） |
| JW-H2 | PASS | H1 | Asyncify toy 两次挂起/恢复，sum=42、wasm 侧计数器完好；sync 对照臂证明挂起计量有鉴别力 |
| JW-S1 | PASS | S1 | 模拟器无 JSPI：`WXWebAssembly` 存在但无 `Suspending`/`promising`，**标准 `WebAssembly` 全局整体缺失**；`WXWebAssembly.instantiate` 管线本身可用（echo=42、bad.wasm 被 TypeError 拒绝） |
| JW-S2 | PASS | S1 | **Asyncify 产物在 `WXWebAssembly` 内两次挂起/恢复、状态正确** —— 回退路线在模拟器级成立 |
| JW-R1 | NOT_RUN | R1 | 无 [业主] 授权真机（gate D-1） |
| JW-R2 | NOT_RUN | R2 | 同上（gate D-2） |

镜像：P-jspi-null、P-wasm-bad（JW-S1），P-async-null、P-async-sync（JW-S2）均 fired + restored。

### 发现台账

1. **JSPI 在全部已测环境缺席**（H1 + S1）。微信 `WXWebAssembly` 面只有 MVP wasm API；DevTools 连标准 `WebAssembly` 全局都没有。`createFxAgent` 所依赖的 `new WebAssembly.Suspending` 在小程序不可用的证据为 S1 级。
2. **Asyncify 回退路线 S1 级成立**：binaryen `--asyncify` 产物 + JS 驱动器在 `WXWebAssembly.instantiate` 内完成两次异步往返，wasm 侧状态连续。fx 改造的技术方向 = 编译期 Asyncify + 宿主 import 层重接。
3. **typings 勘误（事实）**：`miniprogram-api-typings` 声明 `instantiate → Promise<Instance>`，实测 resolve 为 `{module, instance}` —— 产品接入时须按实测解构。
4. **证据上限**：R1/R2 未跑。iOS WKWebView/JSC 与 Android 厂商引擎的 Asyncify 行为未证——尤其 JSC 无 wasm 最优化的层级下 Asyncify 大模块性能存疑。S1 结论不覆盖真机。
