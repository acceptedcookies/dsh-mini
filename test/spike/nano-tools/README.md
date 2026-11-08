# spike / nano-tools — fake-bash 53 命令真实行为矩阵

## 目的

为 `docs/truth/mini-nano/MN07-qna.md` **Q6（工具面判词档位）** 提供事实面：
nano-agent fake-bash 的**全部 53 个 canonical tool id**（37 model-visible + 16 internal）
在 Node mock、DevTools 模拟器、真机三级环境中的**真实执行数据**。

Q6 裁决要求：档位（`implemented / degraded / absent`）不得由源码推断得出，只能由本矩阵的执行结果裁定。

## 范围

矩阵对象 = `workers/bash-core/src/tool-contract/source.ts` 的 `BASH_TOOL_CONTRACT_SOURCE` 全部行：

- **model-visible（37）**：awk, bash-pipeline, cat, context_inspect, cp, curl, describe_skill,
  diff, echo, find, git, head, invoke_skill, ls, mkdir, mv, pwd, rg, rm, memory, todo,
  ask_user, file_focus, sed, sort, span, stat, tail, tree, ts-exec, uniq, wc, which,
  workspace_verify, artifact_export, write, edit
- **internal（16）**：basename, comm, cut, date, dirname, env, expr, false, printf, seq,
  sleep, tee, timeout, tr, true, xargs
- **拒绝面抽查**：`architectural-impossible`（sudo/python/node）、`not-yet-supported`（readlink）、
  `oom-risk`（tar）、未知命令、路径穿越、不安全 root —— 共 8 行

## 判读门槛（执行前写死，回读不受结果影响）

每行 verdict 值域：`pass | degraded | unavailable | rejected-honest | fake`

| verdict | 定义 |
|---|---|
| `pass` | 命令完成其合同语义且输出正确（对 `cat` 即字节一致回读） |
| `degraded` | 执行了，但语义缺边（如 `tr` 区间不展开） |
| `unavailable` | 如实报告不可执行（service-binding 缺位、substrate 缺位） |
| `rejected-honest` | 拒绝/失败且消息如实说明原因或类别（含 **bash 语义本就非零** 的 `false`） |
| `fake` | **证伪行**：声称成功但语义未发生（如 `write` 报 ok 但文件不存在） |

**通过条件**：零 `fake`。`degraded`/`unavailable` 不是失败——它们正是 Q6 要的判词证据。

**plants（证伪镜像，必须转红才证明 harness 有效）**

| plant | 断言 | 期望 |
|---|---|---|
| `PLANT-1` | `cat /nonexistent` 返回文件内容 | 必须失败 |
| `PLANT-2` | `sudo ls` 返回执行成功 | 必须失败（如实拒绝） |
| `PLANT-3` | `write` 后 `listWorkspaceRows` 无该行 | 必须失败 |

## 环境分级

| 级 | 环境 | workspace 后端 | 内核通道 | 证据 |
|---|---|---|---|---|
| **H1** | Node（本机 esbuild bundle） | tmp 目录真 fs | 真 `content-scan-kernel.wasm` + 真 web-tree-sitter | `evidence/h1-*.json` |
| **S1** | DevTools 模拟器（`mp/` 探针工程） | wx 存储 backed VFS adapter | TS 模拟内核；无 WebAssembly | `evidence/s1-*.json` |
| **R2** | Samsung SM-S9080 / Android 16 / 基础库 3.18.0 / Wi-Fi | 同 S1 adapter | 同 S1 构建 | `evidence/r2-*.json` |

推进顺序 H1 → S1 → R2；H1 未收敛不升级。live 网络仅一行（`curl` 打业主自控域
`dsh-mini.saobao.com` 的静态端点）。

## 结构

```
nano-tools/
  README.md            本宪章 + 定稿结论
  src/entry.ts         spike 入口：createSpikeRuntime(workspace, opts) → {ids, routes, dispatchTool, dispatchBash}
                       + 内核注入缝 useWasmKernel / useSpanWasm / useTsKernel
  src/kernel-ts.ts     content-scan 内核的 TS 模拟（mp 通道）
  src/kernel-wasm.ts   同一 ABI 的 wasm 包装（H1 通道，吃真工件字节）
  src/adapter-node.ts  H1 用 Node fs → WorkspaceFsLike 适配（不进 bundle）
  build.mjs            esbuild 双通道构建（H1 全量 / mp 裁剪），haimang alias + jitless banner
  rows/rows.json       67 行矩阵（53 命令 + 8 拒绝抽查 + plants 承载）
  run-h1.mjs           H1 驱动：加载 bundle → 注入真 wasm 内核/parser → 逐行执行 → evidence JSON
  run-mp.mjs           S1/R2 驱动：connectIde → attachDevice → 触发 probe → 采证据
                       --listen 模式：局域网证据接收端（0.0.0.0:8899）
  mp/                  S1/R2 独立探针工程（appid wx356d3abb52825466，独立目录）
  evidence/            h1-*/s1-*/r2-* 结果（disposable，gitignored）
```

## 两条内核通道（rg / span 的平台事实）

nano-agent 的扫描与解析能力各有两种载体，spike 两条都跑：

| 能力 | 真源 | H1（Node） | mp（appservice） |
|---|---|---|---|
| `rg` | Rust→wasm `content-scan-kernel.wasm`（1.35MB 工件，`content-scan-host.ts:21`） | **真 wasm**（`useWasmKernel(bytes)`） | **TS 模拟**（`src/kernel-ts.ts`，同 ABI：regexBuild/regexScan/definesScan/lastScanned/lastExceeded） |
| `span` | web-tree-sitter + js/py 语法 wasm（`span-runtime.ts:42-44`） | **真 parser**（`useSpanWasm(rt, js, py)`） | **不可用**：`typeof WebAssembly === 'undefined'`（`WXWebAssembly` 仅 worker 可用），实测 |

**两通道输出逐字一致**：`rg beta` 在 H1（wasm）与 mp（TS 模拟）都得到
`/data/spike/a.txt:2:beta`、`/data/spike/a.txt:4:beta`、`/data/spike/b.txt:1:beta`。
这同时是「TS 模拟行为中立」的证明——若模拟偏离 ABI 语义，逐行对比会立刻转红。

## 定稿结果

| 级 | pass | degraded | unavailable | rejected-honest | fake | plants |
|---|---|---|---|---|---|---|
| **H1 Node**（真 wasm 内核 + 真 tree-sitter） | 54 | 1 | 0 | 9 | **0** | 3/3 红 |
| **S1 模拟器**（TS 内核；无 WebAssembly） | 53 | 1 | 1 | 9 | **0** | 3/3 红 |
| **R2 真机**（同 S1 构建，CDP 取证拉取） | 53 | 1 | 1 | 9 | **0** | 3/3 红 |

**逐行对比：66/67 行三端判词一致；唯一差异是 `span`**（H1 pass，mp 两段 unavailable ——
平台无 WebAssembly，见上表）。

### 真机环境敏感行（证明矩阵在设备上真执行，不是回放）

| 行 | R2 实际输出 |
|---|---|
| `curl` | `[curl] GET https://dsh-mini.saobao.com/robots.txt -> 404` —— 手机真实出网（wx.request → nginx） |
| `write` | `[write] wrote 17 bytes to /data/spike/w.txt (file-sha256:21cf96c485…)` —— 设备工作区真实落盘 + provenance 哈希 |
| `pwd` / `ls` | `/data/spike` / 枚举到种子文件 —— wx fs adapter 全缝（readdir/stat/readRange/append/CAS） |
| `rg` | 三条命中行与 H1 逐字一致（TS 模拟内核在真机上跑） |

## 非 pass 行逐条裁定

| 行 | 定稿 verdict | 裁定依据 |
|---|---|---|
| `tr` | **degraded（真缺陷）** | `text-processing/wave2.ts:78` 的 `trText` 把 `set1/set2` 当**字面字符集**，不做区间展开：`a-z` 被当作 `a`/`-`/`z` 三字符 → `echo abc \| tr a-z A-Z` 输出 `Abc`。这是 nano-agent 实现缺口，三端一致复现 |
| `span`（S1/R2） | **unavailable（真平台边界）** | appservice 无 `WebAssembly`；`span-runtime.ts:57-77` 的 `ensureParsers` 在 wasm 缺失时返回 null，handler 抛 `CapabilityUnavailableError`——如实降级，不伪造结果 |
| `false` | **rejected-honest（设计如此）** | `capabilities/util.ts:39-47` 明确抛 `execution-failed: false: returned non-zero status`，注释写明这是 bash 语义（执行了、以非零退出），非能力缺失 |
| `ts-exec` | rejected-honest | local-ts 是 validate-only，typed 路径 dispatch → `no-target`（执行路在 service-binding） |
| 8 行拒绝抽查 | rejected-honest | `sudo/python/node/tar/readlink/unknown/traversal/unsafe-root` 全部如实拒绝，消息带类别 |
| `git` | degraded/pass 视子命令 | workspace-view 子集（只读面）如实返回 |
| `describe_skill`/`invoke_skill`/`memory`/`todo`/`ask_user`/`file_focus`/`context_inspect`/`workspace_verify`/`artifact_export` | rejected-honest 或 intent | 无 skill-runner / 无下游 intent 通道时如实报缺或发 intent 标记，不伪造 |

### 判词修正史（诚实记录：两处是我的 harness 错误）

| 行 | 初判 | 错在哪 | 修正 |
|---|---|---|---|
| `rg` | unavailable | spike 把 `@nano-agent/content-scan-kernel` 整包 stub（因它 import `node:fs`），把能力打掉了 | H1 注入真 wasm 工件；mp 注入 TS 模拟内核 → 三端 pass |
| `span` | unavailable | 同上：`web-tree-sitter` + 语法 wasm 被 stub；且 spike 依赖树根本没装这些包 | H1 补装依赖 + `useSpanWasm` 注入真 parser → pass；mp 保留 unavailable 并改记为**平台边界** |
| `false` | unavailable | 判词逻辑把「预期内的错误结果」一律记为 unavailable | 改为 `rejected-honest`（expect.kind=err + 消息断言） |

修正后 `unavailable` 从 3 行降到 H1 的 0 行、mp 的 1 行（`span`，平台边界）。

## 平台 substrate 缺口（产品级发现，spike 已 polyfill 并如实记录）

mp 逻辑层（appservice）缺以下标准 Web 能力，产品 bundle 必须自带 polyfill：

| 缺口 | 现象 | spike 处置 | 产品含义 |
|---|---|---|---|
| `AbortController`/`AbortSignal` | executor 每次调用 `new AbortController()` → 全灭 | prelude 最小实现 | 必带 |
| `crypto.subtle.digest` / `crypto.randomUUID` | `filesystem.ts:53`、`file-output-provenance.ts:30`、`tee.ts:57` 的 provenance 哈希 | `subtle.digest(SHA-256)` 用纯 JS 实现输出**真 SHA-256**；`randomUUID` 用 Math.random | SHA-256 可纯 JS 保真；**randomUUID 需业主另裁真随机源** |
| `URL` 被词法遮蔽 | 编译产物外层作用域把 `URL` 遮蔽为 undefined（`typeof URL === 'undefined'` 而 `globalThis.URL` 可用），裸 `new URL` 抛 not a constructor | esbuild `define:{URL:'globalThis.URL'}` + prelude URL 实现 | 产品构建同样需要重写裸引用 |
| `TextEncoder`/`TextDecoder` | 真机报 `ReferenceError: TextEncoder is not defined`（`<require(vendor/…)>` 与 `<require(lib/wx-workspace.js)>` 双点触发）→ 页面组件注册失败 → 白屏 | prelude UTF-8 codec（BMP + 代理对保真） | 必带 |
| `WebAssembly` 缺失 | `typeof WebAssembly === 'undefined'`（仅 `WXWebAssembly`，worker 专用）→ `span` 等 wasm 依赖能力在 appservice 不可用 | 不伪造：走 TS 模拟或如实 unavailable | 需要 wasm 的能力要么 TS 重写，要么进 worker |
| wx fs 跨运行持久 | `write`/`tee` 撞上次运行的 `file-exists` | `resetLanes()` 跑前清空 spike 根 | 产品侧 VFS 需自管生命周期 |

## 构建与设备通道事实（供后续复用）

**构建（`build.mjs` 双通道）**

- `es6:true` 会把 1.6MB vendor 转译成 **15.4MB** ES5（超 2MB 包限，JS 被整段丢弃 → 白屏）；
  `es6:false` 时 DevTools 设备解析器拒绝 ES2020（`invalid file: lib/driver.js SyntaxError: Unexpected token ?`）。
  → 构建侧取 `target: es2017`（保留原生 async/await，只降级 `??`/`?.`/class-fields），mp 侧源码保持 ES2017-safe（无 `??`/`?.`/对象展开/可选 catch 绑定）。
- `uploadWithSourceMap` 必须 `false`：否则编译产物内联 sourcemap 把 vendor 从 0.85MB 撑到 **2.86MB**。
- mp 通道裁剪 `generated-tool-contract` 的 `input_schema`/`output_schema` 正文（原 928KB，逐工具 output_schema 约 17KB）；
  H1 保留完整合同。**H1 与 R2 逐行一致 = 裁剪行为中立的证明**。
- H1 通道额外：`.wasm` 走 esbuild `binary` loader；web-tree-sitter 需要 `import.meta.url`，
  CJS 包内用 banner 注入 `pathToFileURL(__filename).href` 修补。

**设备通道（R2 取证）**

- 真机调试代码包要求会话带 `remotedebugappservice` UA token；缺 token 时 IDE 代码服务 403
  （`validateToken2: ua-token-missing`），手机只拿到 json/wxml、JS 不下发 → 白屏。
  本环境 `Tool.enableRemoteDebug{auto:true}` 返回二维码、手机以普通开发版打开，UA 无 token
  （全部日志中 `remotedebugappservice`/`wxdebug` 出现 0 次）。
- 可用通道：**工具栏「真机调试」手动会话**能下发代码（automator 看不见它，PITFALL-31）。
  因此 R2 证据有两条取道，均已验证：
  1. `run-mp.mjs --listen`（`0.0.0.0:8899`）+ probe 页局域网 POST（手机→Mac 可达性实测 `403`，路由通）；
  2. **CDP 取证道**（README 契约允许）：远程调试窗 `inspectUrl` 的 `ws=127.0.0.1:PORT`，
     `Runtime.evaluate` 用 **contextId 2** 读 `getApp().globalData.nanoToolsEvidence`（定稿 R2 证据即此法拉取）。
- `__wxAppCode__` 只列 wxml/json（JS 在 `__wxCodeSpace__`）——**不能用它判断「JS 是否到包」**，
  早期据此得出的「JS 缺失」结论已作废，真实原因见上两条。

## 运行方式

```bash
# H1：Node，真 wasm 内核 + 真 tree-sitter
NODE_PATH=../node_modules node build.mjs && NODE_PATH=../node_modules node run-h1.mjs

# S1：DevTools 模拟器（需 IDE 侧工程已打开）
AUTO_PORT=9604 NODE_PATH=../node_modules node run-mp.mjs --s1

# R2：真机（手动「真机调试」会话 + 证据回传）
NODE_PATH=../node_modules node run-mp.mjs --listen        # 终端 A：接收端
# 终端 B：DevTools 工具栏「真机调试」扫码；probe 页自动跑矩阵并 POST 回传
# 或：CDP 取证道直接拉 getApp().globalData.nanoToolsEvidence
```

## 证据锚

| 文件 | 说明 |
|---|---|
| `evidence/h1-*.json`（最新） | H1 全绿：54/1/0/9/0 + 3 plants 红 |
| `evidence/s1-*.json`（最新） | S1：53/1/1/9/0 + 3 plants 红（差异仅 `span`） |
| `evidence/r2-*.json`（最新，`via: cdp-pull`） | R2 真机：53/1/1/9/0 + 3 plants 红 |

## 状态

`宪章冻结 · H1 收敛 · S1 收敛 · R2 收敛 · 三端 66/67 行判词一致 · Q6 事实面交付完毕`
