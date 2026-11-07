# test/mn06 — EP-1 durable 收敛套件

真 App（DevTools）+ 影子端（Node 同协议客户端）+ 上帝视角（admin S3 测试桶）。
不建双模拟器、不 mock 数据面、不新增 App 测试钩子。

## 1. 前置

- FRD1：MinIO + `cloud/durable/dev.mjs`（测试入口）在 `127.0.0.1:9095`；SSH 隧道 `9095`/`9000`。
- `.anote/frd1/gateway.env`（600，gitignored）：`TICKET_SECRET` `ADMIN_TOKEN` `S3_*` `PUBLIC_BASE`。
- DevTools 已开，automator 端口（默认 `9602`）可用；**不要关闭 DevTools**。
- App 测试身份：`TEST_OID` 固定为合成 oid（默认 `mn06-test-oid`）；真实 openid 不触。
- LLM：dev 环境经 `cloud/sim` 本地代理（3426）真实转发 magpie；durable 数据面仍是 FRD1 网关。

## 2. 命令

```bash
node test/mn06/env.mjs                 # env/600/端点白名单自检（缺 key exit 3）
node test/mn06/entry-isolation.mjs     # 生产/测试入口隔离 13/13
node test/mn06/parity.mjs              # 旧 test-s3 (74e8aab) vs 新 core golden A/B
node test/mn06/tombstone.mjs           # T04–T07（unit/remove/recover/summary）
node test/mn06/matrix.mjs              # C4a/C4b/C1/C2/C3 三层矩阵
node test/mn06/alarm30.mjs             # T21 真 30s loop（约 33s）
node test/mn06/probe-sop.mjs           # probe/ SOP（仅 probe 窗口；窗口外 exit 3）
node test/mn06/docs-check.mjs          # handoff/limits/closure 静态收口
node test/mn06/acceptance.mjs          # 9 行验收矩阵
node test/mn06/regression.mjs          # 全量回归（注入 127.0.0.1:9095）
```

`matrix.mjs --only C1,C2 --repeat N` 可子集/重复；C4 先于 C1–C3。

## 3. 矩阵

| case | 断言 | App | shadow | God |
|------|------|-----|--------|-----|
| C4a | 冷 App 无票写 → 铸票 → 收敛 | `hasFreshTicket()===false`、本地行 | 写前无行、写后有行 | `dsh-mini/vfs/{oid}/rows/...` 行 |
| C4b | 冷 App 无票删 → 铸票 → 不复活 | 本地行消失、碑在 | 远端行消失 | 行键消失 |
| C1 | 真 turn → state handoff | `__diagnostics` turn 进度/itemCount | `state/{sid}` 含 checkpoint | state 行 |
| C2 | shadow claim → App prompt | `会话写者冲突` toast/diag | claim holder=shadow | claim 行 holder |
| C3 | App 写 VFS → shadow pull+hydrate | `vfs.read` 字节 | sha256=object_key | object 字节 + row |

报告：`{suite:'mn06', cases:[{id,pass,app,shadow,god}]}`；失败非 0。

## 4. 证据与 deferred

- `MN06-T01` parity：commit + golden diff 0 + 套件辅助计数 + UTC。
- `MN06-T17` 9 行：`scope` + `evidence_state`（`green|partial|deferred|blocked|na`）；#1/#5/#6 显式 partial。
- `MN06-T18` 回归：`BASE/DURABLE=127.0.0.1:9095` preflight；NOTE/SKIP 不计 PASS；`ide-durable` E openid=TEST_OID。
- deferred：生产切流/旧客户端、物理 OS kill/真机、云函数 sweeper 部署、`S3ObjectBackend`、`fx` lane、`vision-dual https:`。
- `soak`（`matrix --repeat 10`）只作 advisory，不入闸。

## 5. 反假绿刻死

- 只看 exit 0 不算：每 case 三层布尔 + 四元组。
- `ide-durable` NOTE 不计 PASS；`local-sweeper` 单 tick 不算 #5。
- God view 读 FRD1 测试 bucket；POD1 审计另用只读 `find` before/after（测试 oid 前缀），不冒充 God view。
- 默认 `BASE=POD1` 的既有套件由 `regression.mjs` preflight 拒绝。
- 直连 MinIO 的 `s3-probe` 不能替代 `probe/` SOP。

## 6. 证据包（T19a，2026-11-07 本轮）

> 本轮 `BASE=DURABLE=http://127.0.0.1:9095`，`TEST_OID=mn06-test-oid`；`acceptance.mjs` 自跑
> `regression.mjs`，并用 token 绑定本轮 artifact（拒绝历史输出）。多套件计数与运行时间见
> 最终 artifact 归档：`.anote/reviews/mini-nano/1st-wave/MN06/acceptance-artifact.json`（token `59e1c317…`，本轮 05:10:33–05:15:41 UTC）；下表为 Test-ID 四元组索引。

| Test-ID | 命令 | 结果（本轮） | 运行时间（UTC） | 层 |
|---------|------|--------------|-----------------|----|
| T01 | `node test/mn06/parity.mjs` | 31/31，golden A/B diff 0 | 05:10:34 | 合同 |
| T02 | `node test/mn06/entry-isolation.mjs` | 13/13（生产闭包无 admin 面） | 05:10:33 | 静态+启动 |
| T04–T07 | `node test/mn06/tombstone.mjs` | 24/24（unit/remove/recover/summary） | 05:10:53 | unit/集成 |
| T08–T12 | `node test/mn06/matrix.mjs` | 5/5（C4a/C4b/C1/C2/C3 三层） | 05:10:53 | App/shadow/God |
| T13 | `node test/mn06/env-check.mjs` | 4/4（600/缺 key exit 3/schema） | 05:10:33 | env |
| T14/T16 | `node test/mn06/docs-check.mjs` | 78/78（五节/原语/limits/静态） | 05:10:33 | 契约 |
| T15 | `node test/mn06/probe-sop.mjs` | 4/4；probe `acb163e` → revert `4e2227e` | 04:40:03 | `/v1/state` SOP |
| T17 | `node test/mn06/acceptance.mjs` | 9/9 rows（#1/#5/#6 partial） | 05:10:33–05:15:41 | 9 行矩阵 |
| T18 | `node test/mn06/regression.mjs` | 19/20 suites + 1 known E9；exit 0 | 05:10:33–05:15:37 | 全量 |
| T19a/T19b | `docs-check` + acceptance artifact | 五节/静态 0 命中/证据字段齐 | 05:10:33 | 静态 |
| T20 | `node test/mn06/matrix.mjs --repeat 10` | 未跑（advisory，不入闸） | — | soak |
| T21 | `node test/mn06/alarm30.mjs` | 6/6；2 ticks；间隔 ≥30s | 05:12:05 | 真 30s |

**deferred（逐项理由/承接）**

- 生产切流/旧客户端 — `cloud/durable/README.md` §3 七步 runbook；EP-1 不执行。
- 物理 OS kill/真机 — `cold-state` 仅 pump 级 `killAfter`；R-lane/设备在场窗口。
- 云函数 sweeper 部署 — 控制台 env/域名窗口；本轮同码 `sweepTick` + 真 30s。
- `S3ObjectBackend` — 合约占位 `not-configured`；对象后端后续窗口。
- `fx` lane — `get_weather` 不在 kernel 工具面；交 fx lane。
- `vision-dual https:` — 需上游可达 HTTPS；测试面 `data:` 正常。
- `soak` — advisory，不入闸；不建 release gate / CI 仪式。
