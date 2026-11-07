# 测试体系重建草稿

> 状态：草稿（2026-11-07）。不是测试套件、不是 CI 配置、不是 release gate。
> 用途：阶段命名测试拆除后，登记值得重建的高价值线路；重建时由业主决定取舍。
> 旧 `test/mn01`–`test/mn06` 已按业主决定整体删除；`test/spike` 保留为 fx/wasm 取证工作区，不是测试层。
> 当前 `scripts/dev-cli` 保留，仅保留 `__diagnostics` / `__errorBus` 两枚 DevTools 调试钩子；其余测试钩子已从 `app.ts` 拆除。

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
