# 测试体系重建草稿

> 状态：草稿（2026-11-07）。不是测试套件、不是 CI 配置、不是 release gate。
> 用途：阶段命名测试拆除后，登记值得重建的高价值线路；重建时由业主决定取舍。
> 旧 `test/mn01`–`test/mn06` 已按业主决定整体删除；`test/spike` 保留为 fx/wasm 取证工作区，不是测试层。
> 当前 `scripts/dev-cli` 保留，仅保留 `__diagnostics` / `__errorBus` 两枚 DevTools 调试钩子；其余测试钩子已从 `app.ts` 拆除。
> **2026-11-07 业主否决**：§2–§6 的 unit / contract / e2e 分类与清单全部作废，仅作历史草稿保留；当前唯一测试模型见 §7 Simulation。

## 1. 重建原则

- **按能力命名，不按阶段命名**：`test/contract/`、`test/e2e/`、`test/unit/`、`test/tools/`；禁止 `mn01`–`mn06`、`ep1`、`wave1` 一类目录或文件名。
- **业务 E2E 优先**：每条 P0 线路必须落到真实 App / 真实端点 / 真实对象存储的可观察结果，不以 exit code 或静态计数代替。
- **单一测试身份**：固定一个合成测试 oid，所有测试数据写在该前缀下；生产真实 oid 只读，不得写。
- **环境隔离**：写面只打 FRD1 测试网关（当前已停用，重建时启用）或本地 `dev.mjs`；生产 `dsh-mini.saobao.com` 只做只读 smoke。
- **反假绿**：三层收敛（App / Node shadow / 远端对象）必须同时成立；alarm 必须断言恰一次；NOTE/SKIP 不计 PASS；mock 控制面时必须标明，数据面不得 mock。
- **不做仪式**：不建静态文档对账、阶段验收矩阵、无业务价值的 golden A/B、soak 闸、未获业主批准的 release gate。

## 2. 高价值线路登记

优先级：P0 = 业务/合同不可回归；P1 = 关键收敛与故障恢复；P2 = 诊断/体验面。

### 2.1 业务 E2E（真实 App）

| ID | 线路 | 断言（可观察结果） | 载体 | 优先级 |
|----|------|--------------------|------|--------|
| E2E-01 | 冷启动 → unlock → durable session → prompt → turn → 重载续跑 | 真票；`state/{sid}` 有 checkpoint；重载后 turn 续跑且不重复 | DevTools + FRD1 测试网关 | P0 |
| E2E-02 | 离线 VFS 写/删 → 铸票 → 收敛 | 本地行/碑 → 远端 row/object；删除不复活；pending 清零 | App + Node shadow + 远端行 | P0 |
| E2E-03 | 多写者 claim 冲突 | shadow 持 claim 时 App 提示「会话写者冲突」；holder 与远端一致 | App + shadow + 远端 claim | P1 |
| E2E-04 | VFS 文件 → artifact → 公网 `/a/` | 写入字节可回读；publish 返回 sha；`/a/{sha}` 200 且字节一致；range 正确 | App + 测试网关 | P0 |
| E2E-05 | 30s alarm 恢复 | due alarm 被消费恰一次；resume 完成；无重复 tool 执行 | 本地/云 sweeper + 测试网关 | P1 |
| E2E-06 | 生产只读 smoke | `/healthz` 200；无票 401；真实 oid `state/get`/`vfs/list` 只读成功；跨 oid 隔离 | `https://dsh-mini.saobao.com` | P0 |
| E2E-07 | agentic chat + 错误 UI | local-runtime → magpie 真轮；tool_call 结果可见；取消/错误分类进 error bus；UI 不崩 | DevTools | P1 |
| E2E-08 | 图像双车道 | `data:` 与 `https:` artifact 均可被视觉模型识别 | DevTools + 生产/测试 artifact | P2 |

### 2.2 合同测试（Node，无 App）

| ID | 线路 | 断言 | 优先级 |
|----|------|------|--------|
| C-01 | durable 五端点 | `state/get|put-cas`、`claim`、`alarm/due|claim`、`vfs/put|get|del|list`、`artifacts/publish` 的状态码/错误枚举/字段形状 | P0 |
| C-02 | CAS 与条件写 | `If-Match` 冲突 412；`If-None-Match:*` 创建幂等；404/413；body 256KB 上限；并发恰一成功 | P0 |
| C-03 | 票据合同 | scope=`byok-proxy`；过期拒绝；oid 由服务端注入；body 内 openid 不读；路径穿越拒绝 | P0 |
| C-04 | 墓碑/LWW/删除意图 | 删除意图只存一份；恢复不复活；远端新于碑时 LWW 重建；512 上限淘汰 | P1 |
| C-05 | VFS 边界 | 8MB 对象上限；行面 6MB 预算；list ≤1000 分页；前缀隔离；CJK 续页 | P1 |
| C-06 | S3/MinIO 条件写语义 | 同 etag 并发两写 → 200/412；Range/HEAD/List 形状与网关一致 | P1 |
| C-07 | 生产/测试入口隔离 | 生产闭包无 `/dev/*`、无 admin 面；缺凭证 fail-closed | P0 |

### 2.3 Unit（纯 Node）

| ID | 线路 | 断言 | 优先级 |
|----|------|------|--------|
| U-01 | tombstone / pendingSummary | join/remove/recover/LWW/预算淘汰全分支 | P1 |
| U-02 | remote-cas / provider / ticket cache | 条件写构造、后端择路、票据新鲜度、401 重铸 | P1 |
| U-03 | VFS paths/journal/read-view | 五根裁决、只读闸、digest 稳定/变更、有界陈旧快照 | P1 |
| U-04 | error classification | 错误码 → UI/台账分类；silent 通道不弹 | P2 |

### 2.4 工具面（dev-cli 自检，不冒充业务）

| ID | 线路 | 断言 | 优先级 |
|----|------|------|--------|
| T-01 | doctor / catalog / registry / tasks | 工具目录可枚举；注册表对账；pending/taskId 轮询终态 | P2 |
| T-02 | automator 真机四件套 | 真机 remote + diag/storage/console/shots；设备缺席只允许 SKIP | P2 |

## 3. 重建所需环境

| 面 | 要求 | 当前状态 |
|----|------|----------|
| FRD1 测试网关 | `127.0.0.1:9095` `dev.mjs` + `/dev/ticket`；systemd `dsh-mini-test-gateway`；env 600 | 已停止/禁用；重建时启用 |
| 测试桶 | MinIO `dsh-mini-test`；按 `dsh-mini/{kind}/{oid}/` 隔离；teardown 删前缀 | 保留 |
| 生产只读面 | `https://dsh-mini.saobao.com` → 9097 `server.mjs` / `dsh-mini-prod`；禁止写真实 oid | 运行中 |
| DevTools | MCP / automator；`AUTO_PORT` 复用已开会话；**不要关闭 DevTools** | 由业主掌控 |
| 真机 | 仅 SOTER/unlock、物理 OS kill 需要；不可用则显式 deferred | 待业主 |

## 4. 不再重建的旧件

- `test/mn01`–`test/mn06` 全部套件、`docs-check` 静态对账、9 行阶段验收矩阵。
- 阶段命名脚本：`scripts/mn01-harness.mjs`、`scripts/local-sweeper.mjs`、`scripts/vfs-agentic-test.mjs`、`scripts/fx-agentic-test.mjs`（已删除；历史证据留在 closure/rules 文档）。
- 以 exit 0 / PASS 计数代替业务断言的任何闸；未获业主批准的 release gate。
- `test/replay` 输出目录已改到 `.anote/replay`（dev-cli 录制导出仍是工具，不是测试）。

## 5. 建议重建顺序

1. `test/contract/durable.mjs`：C-01/C-02/C-03/C-07（Node，先接本地 `dev.mjs` 或测试网关）。
2. `test/e2e/production-smoke.mjs`：E2E-06（只读，防止生产入口回归）。
3. `test/e2e/app-resume.mjs`：E2E-01（DevTools + 测试网关）。
4. `test/e2e/vfs-convergence.mjs`：E2E-02/E2E-04（App + shadow + 远端行/对象）。
5. `test/e2e/alarm-resume.mjs`：E2E-05。
6. `test/unit/*`：U-01–U-03，作为快速反馈，不替代 E2E。
7. P2：E2E-07/E2E-08、T-01/T-02。

## 6. 待业主决定

- 测试网关重建位置：FRD1 `9095`，还是本地 `cloud/durable/dev.mjs` + SSH 隧道。
- 真机窗口：SOTER/unlock 与物理 OS kill 是否纳入本轮验收。
- 是否保留 `scripts/dev-cli` 的 `__diagnostics` / `__errorBus` 两枚调试钩子（当前保留）。
- 测试 oid 命名与清理策略（单一合成 oid，禁止真实 openid）。

---

## 7. Simulation 测试（业主模型，2026-11-07；取代 §2–§6）

### 7.1 定义

Simulation 不是 unit / contract / e2e 分层，而是**基于微信开发者工具的真实业务 E2E**：

- 每条 simulation 都是一条完整业务旅程，从真实 App 页面/组件进入，经过真实 wx API、真实 VFS、真实 kernel/fx、真实 HTTP/WS 传输，最后落到真实 durable 网关与对象存储。
- 合同断言不单独成层，而是嵌入业务旅程：CAS 412 由多写者流程触发，VFS 上限由真实上传触发，票据隔离由真实 App/第二身份触发。
- mock 只允许发生在**外部提供方边界**：LLM 上游、微信云控制面/SOTER、可控时钟/故障注入。接口形状、App 内部服务、VFS、durable 客户端、网络传输不得 mock。
- 每条 simulation 必须同时具备 **mock-pass** 与 **live-pass**；两者都跑完才算完整，不能用 mock 结果冒充 live。
- live 的定义是真实业务 + 真实数据面 + 真实接口。DevTools 没有真机时，SOTER/微信云控制面只能是受控 mock，必须在结果中标注 `control_mock`，不得写成 live 全绿。

### 7.2 形态

一条 simulation = 一个 `test/simulation/sim-{slug}/` 目录：

```
test/simulation/
  lib/                         # DevTools 连接、截图、mock 上游、数据断言（不打包）
  sim-{slug}/
    run.mjs                    # 入口；语言不限，py/ts/sh 均可
    fixtures/                  # mock 数据、scripted LLM/vision/tool 响应
    README.md                  # 业务旅程、mock/live 前置、证据口径
```

推荐入口统一支持：

```bash
node test/simulation/sim-{slug}/run.mjs --mode both   # 默认；先 mock 后 live
node test/simulation/sim-{slug}/run.mjs --mode mock
node test/simulation/sim-{slug}/run.mjs --mode live   # 缺 live 条件时报 live-blocked，不报 PASS
```

证据统一落 `.anote/simulation/sim-{slug}/{mode}/{UTC}/`：`result.json` + `shots/*.png` + 数据快照。`test/simulation/` 不进入小程序包、不注册 npm script、不接 CI。

### 7.3 当前建议构建数量与命名

**第一波 8 条核心 + 2 条 P2**。核心覆盖“启动/对话/文件/离线/多写者/闹钟/引擎/生产面”八条真实业务线；P2 覆盖多模态与视觉模式。再多会变成仪式，无法逐条维护双形态证据。

| # | 名称 | 业务旅程 | mock-pass 起点 | live-pass 终点 | 数据验证 + 截图验证 |
|---|------|----------|----------------|----------------|----------------------|
| 1 | `sim-boot-session` | 冷启动 → 主题/壳 → unlock → durable session → prompt → turn → 杀进程/重载 → 续跑 | `cloud/sim` + scripted LLM + 合成 oid | FRD1 测试网关 + 真 durable + 真票（SOTER 在 DevTools 标注 `control_mock`） | `state/{sid}` checkpoint、transcript 不重复、turn 续跑；截图：启动页/会话页/续跑后 |
| 2 | `sim-agentic-chat` | 输入 prompt → 流式 → tool call → cancel → 上游错误/重试 | scripted LLM/tool/error | 真 magpie + 测试网关 | 消息、tool 结果、transcript、error center 分类；截图：正常/取消/错误三态 |
| 3 | `sim-vfs-roundtrip` | 写文件 → 列表 → 读 → range → 删 → artifact publish → 公网 `/a/` 回读 | 本地测试网关 + 测试桶 | FRD1 9095 + `dsh-mini-test` MinIO | 字节/sha/远端 row/object、8MB/256KB/list 上限、`/a/` 字节一致；截图：文件列表/artifact 预览 |
| 4 | `sim-vfs-offline` | 断票/离线写删 → 恢复 → reconcile → 删除不复活 | 强制离线 + 测试网关回放 | 真测试网关 + MinIO | 本地行/墓碑、远端行/对象、pending 清零、LWW；截图：离线提示/收敛后状态 |
| 5 | `sim-claim-conflict` | shadow 持 claim → App prompt → 「会话写者冲突」→ 释放 → 重试 | shadow Node 客户端 + 测试网关 | 真测试网关 claim | holder、冲突 UI、重试后 state；截图：冲突提示/恢复 |
| 6 | `sim-alarm-resume` | 建 due alarm → sweeper tick → resume → tool 恰一次 | 本地 sweeper + 受控时钟 | 云函数 sweeper + 真 30s + 测试网关 | alarm 消费恰一次、tool 计数=1、resume 完成；截图：恢复中/完成 |
| 7 | `sim-engine-routing` | 设置页 provider/model/engine（local/cloud/magpie）→ bio 门禁 → enroll → 真轮 | `cloud/sim` + mock bio/challenge | 真测试网关 + 真 magpie；真 SOTER 仅真机，否则 deferred | 引擎戳记、模型白名单、会话车道、设置页状态；截图：设置/注入/真轮 |
| 8 | `sim-production-surface` | 生产只读：healthz、无票 401、真实 oid state/get + vfs/list、`/dev/*` 404 | 本地测试网关 + 合成 oid | `https://dsh-mini.saobao.com` 只读 | 状态码/响应形状/跨 oid 隔离；禁止写真实 oid；截图：App 生产配置只读页 |
| 9 | `sim-image-vision` | 上传图片 → `data:` / `https:` artifact → 视觉识别 | scripted vision | 真 magpie | 图片 block、识别文本、artifact 字节；截图：图片气泡/识别结果 |
| 10 | `sim-visual-modes` | 浅色/深色 × 桌面/手机：启动、设置、会话、VFS 文件页 | mock 数据 | 测试网关真数据 | 关键文本/元素/布局，截图基线 diff（仅稳定页面，不做像素级 release gate） |

### 7.4 mock-pass / live-pass 口径

- `--mode both` 是默认：先跑 mock-pass，再跑 live-pass；任一缺失即 `incomplete`，不冒充全绿。
- mock-pass 只替换外部提供方，App 代码、页面路由、VFS、kernel/fx、HTTP 客户端、durable 合同全部是真的。
- live-pass 必须打真实测试网关与真实对象存储；`sim-production-surface` 只读打生产，任何写操作禁止。
- 报告必须分列 `mock-pass` / `live-pass` / `control_mock` / `deferred`；不得合并成一个 PASS 数字。
- 真机 SOTER、物理 OS kill 等 DevTools 不可覆盖项，登记为 `device-deferred`，不阻塞 simulation 其余部分。

### 7.5 数据验证与截图验证

- **数据验证**：每个检查点读 App 侧 page data / storage / VFS / diagnostics，再经测试网关或 MinIO 只读读远端 row/object/alarm/claim，断言具体值；不以 exit code 代替。
- **截图验证**：每条 simulation 至少 3 张截图（起点、动作后、终态/错误）；用 automator 断言当前 route 与关键元素/文本存在，截图作为证据落 `.anote/`；稳定页面可做基线 diff，但不做像素级 release gate。
- **证据信封**：`result.json` 记录 `sim`、`mode`、`git_head`、`endpoint`、`checks[]`、`shots[]`、`control_mock`、`deferred`；任何一项缺失即不算完整。

### 7.6 与发布的关系

- `test/simulation/` 不被 `app.json`/`package.json`/构建脚本引用；独立删除整个目录，`npm run typecheck`、开发者工具编译、上传、发布均不受影响。
- 不设 CI、不设 release gate、不设“必须 sim 全绿才能发布”的规则；simulation 结果只作为业主决策的参考证据。
- 不建立阶段命名目录、不建立 unit/contract/e2e 子层、不建立静态文档对账。

### 7.7 建议建设顺序

1. `sim-boot-session`（打通 DevTools + mock/live 双形态 + 截图/数据证据骨架）
2. `sim-agentic-chat`（真轮、流式、tool、错误 UI）
3. `sim-vfs-roundtrip`（文件与 artifact 主线）
4. `sim-vfs-offline`（恢复与墓碑）
5. `sim-claim-conflict`（多写者）
6. `sim-alarm-resume`（30s 闹钟）
7. `sim-engine-routing`（引擎/模型/设置）
8. `sim-production-surface`（生产只读）
9. P2：`sim-image-vision`、`sim-visual-modes`

### 7.8 需要业主确认的假设

- live-pass 中 SOTER/微信云控制面在 DevTools 仍为受控 mock；真机验证是否另列 `device-deferred`。
- 测试网关重建位置：FRD1 `9095`，还是本地 `cloud/durable/dev.mjs` + SSH 隧道。
- 截图基线是否入库；建议只存 `.anote/`，仓库只留脚本与 fixture。
