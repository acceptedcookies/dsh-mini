# sim-wx-alarm

> **微信云 alarm 近似（WX alarm approximation），不是 Cloudflare Durable Object alarm 本体。**
> 我们的 alarm = 微信云函数 30s timer + S3 CAS 行 + 按 oid 的 `alarm/due` 扫描 + `alarm/claim` 条件删。
> 本 sim 证明的是这个近似合同；DO 的 per-object alarm、自动重试、覆盖/取消语义只按下方近似表逐项验证，不宣称 DO 本体。

## 1. 业务旅程（目标）

建 due alarm → 30s sweeper → claim → resume → tool 恰一次 → 终态 / abandon。

- 当前实现（v1 contract smoke）：App 启动/输入截图 + `alarm` 行 arm / `alarm/due` / 两次 `alarm/claim`。**没有** `sweepTick`、`runPump`、resume、tool 计数。
- live 不走 SSH 隧道。当前是 `live-blocked`：手机没有隧道，公网也没有 `/dev/ticket`。
- 目标：M1 contract + M2 local sweeper + Live C/A/B（见 §4）。

## 2. DO alarm vs 微信云近似

| DO alarm 特性 | 微信云近似 | 本 sim 应证明 |
|---|---|---|
| per-object schedule（对象上的时间点） | 键 `alarms/{dueTs}-{sid}` + `alarm/due` 按 dueTs 过滤 | 过去/未来/等于边界；NaN/负/Infinity；重复键 |
| at-most-once delivery | `alarm/claim` 条件删（If-Match） | 顺序第二次 404；并发恰一 200；wrong holder/missing key |
| at-least-once execution | 先 `runPump` 后删行 + session claim + rearm | kill/崩溃/重试；tool 恰一次或如实标 at-least-once |
| 自动重试/退避 | `rearmOrDrop`：30s × 2^(attempts-1)，5 次 abandon | attempts 递增；5 次 `alarm-abandoned`；412 并发重臂 |
| 覆盖/取消 | 无显式 API；`alarm/due` 只列 due，未来行不可列举 | future alarm + `clear()`；已删会话是否被未来 alarm 复活 |
| 单调度器 | 云函数 30s timer + App `tick.ts` 30s | 重叠 invocation、60s timeout、claim TTL 90s |
| alarm handler | `runPump` | idle 完成；waiting resume；tool 恰一次；fenced/claim-denied |
| 对象隔离 | 票 oid → 键前缀；服务端注入 openid | 跨 oid 404；无票/过期/错 scope 401；key 穿越 400 |
| 可观测性 | `errorBus` 的 `alarm-abandoned` + 日志 | abandon 事件可见；不静默丢恢复意图 |

## 3. 当前价值与缺口

**已证明（contract 层）**

- `alarms/{dueTs}-{sid}` 可由 `state/put-cas` 写入；
- `alarm/due` 用 `now` 能列出 due 键；
- `alarm/claim` 第一次 200、第二次 404。

**未证明（journey 层）**

- 没有 `sweepTick`/`runPump`：alarm 从未被真正消费；
- 没有 resume/tool：无法证明“tool 恰一次”；
- App 截图 `needUnlock:true`，prompt 与 alarm session 无关联；
- `live` 是 FRD1 测试网关合同，不是云函数 30s；
- `control_mock` 列了 `soter-devtools`，但本 sim 没走 SOTER；
- `fence`/`holder`/`now`/`writeAlarm` 的合同含义未在测试中体现。

## 4. 重构目标（分层）

| 层 | 内容 | 工具 / 入口 |
|---|---|---|
| **M1 contract** | `alarm/{due,claim}` + auth/oid/key/clock/duplicate/future 负例 | 现有 `startLiveGateway` + `memory-s3` + `devTicket` |
| **M2 local sweeper** | 真实 `host.sweepTick` + 真实 kernel + 内存 CAS；idle/waiting/tool/rearm/claim-denied/killAfter | 新 `sweep.mjs`/`clock.mjs`/`tool-counter.mjs`；可复用 B-04 的 host smoke 内核 |
| **Live C（same-code）** | 本地 `sweepTick` + 测试网关 + scripted LLM/tool；完整链 | 标 `live-local`/`same-code`，不冒充云函数 |
| **Live A（cloud transport）** | 真云函数 + 生产 worker + 合成 oid + idle state；只证 30s/枚举/at-most-once | opt-in；需 `byok_keys` 插入/删除确认；state/claim 残留登记 |
| **Live B（cloud journey）** | 公网测试网关 + 测试 sweeper 云函数；完整 cloud journey | 需要域名/nginx/ticket secret/测试部署；未就绪保持 `live-blocked` |
| **UI** | 仅当 App session 与 alarm session 真正对齐时测 unlock/resume/tool 卡 | 否则明确 `ui-deferred`，不用锁屏截图冒充 |

## 5. 负例（按核心失败面，不是全量错误枚举）

- **auth/oid**：无票 401、过期票 401、错 scope 401、跨 oid claim 404、`..`/`//`/`dsh-mini` 段 400。
- **key/body**：缺 key、坏 JSON、缺 `sessionId`、缺 `dueAt`、`kind` 非 `turn-resume`、`attempts` 非数值、dueTs 负/NaN/Infinity。
- **claim**：并发两请求恰一 200；wrong holder；missing key；If-Match 412；后端 500；claim body 身份。
- **clock**：`now` 缺省、过去、未来、NaN、Infinity；`now` 是生产合同参数，不是纯 mock 钩子。
- **sweep**：同一 sid 两条 due、>batchLimit、未来行不占批额、腐行不终止整批、5 次 abandon、`alarm-abandoned`。
- **lifecycle**：future alarm + `clear()`；删除会话后未来 alarm 是否复活；state/claim 残留（B-06）。

> 入口：`node test/simulation/sim-wx-alarm/negatives.mjs`；当前 13/13 `negatives-pass`（本地 `dev.mjs` + memory S3，不触生产/测试桶）。
> 入口：`node test/simulation/sim-wx-alarm/m2-sweeper.mjs`；当前 6/6 `m2-pass`（真实 `host.sweepTick` + 真实 kernel + memory CAS；idle / waiting tool / claim-denied rearm / 5 次 abandon / killAfter 续跑 / fenced rearm）。
> `claim-denied` 的 M2 断言是 **characterization**：当前 `rearmOrDrop` 会写一条 attempts=1 的未来 alarm；是否改成“对手在跑时不 rearm”是 runtime/合同决定，不由本 sim 推断。
> Out of scope：checkpoint 413/compaction（B-07/EP-2）、UI resume（除非 App session 与 alarm session 对齐）、real-S3 M2（由 Live-A/Live-B 覆盖）。

## 6. Live-A / Live-B 入口

| 入口 | 拓扑 | 证明 | 状态口径 |
|---|---|---|---|
| `node live-a.mjs` | 生产 `https://dsh-mini.saobao.com` + 合成 oid + 本地 mint 票 | alarm 写入 → 云函数 sweeper 真 30s 消费 → alarm 恰一次 → state 仍 idle | `live-a-pass`（transport；`deferred: resume/tool`） |
| `node live-b.mjs` | 公网 `https://dsh-mini-test.saobao.com` + `sweeper-test` + 真实 oid + test bucket | due → 真 30s → pending `sim_echo` → tool=1 → scripted final → idle | `live-pass`（journey；`deferred: ui`） |
| `node run.mjs --mode mock` | 本地 `dev.mjs` + memory S3 | alarm arm/due/claim 合同 | `mock-pass` |
| `node run.mjs --mode live` | `127.0.0.1:9095` SSH 隧道 | 同一套 alarm 合同 | `not-phone-path`（不是 live-pass） |

**Live-A 前置**：外部 provision 合成 `byok_keys` 记录，`SIM_LIVE_A_META` 指向 `{oid,sid,dueTs}`；跑完删除 `byok_keys` 记录。生产桶的 state/claim 行因 B-06 无删除端点会残留，evidence 里如实登记。

**Live-B 前置**：

- FRD1 测试网关 `dsh-mini-test.saobao.com` 已由 nginx 反代到 `127.0.0.1:9095`，`/dev/*` 404；
- `sweeper-test` 云函数（Nodejs20.19 / 60s / 30s timer）：
  - 源码/模板/部署器已固化在 `sim-wx-alarm/sweeper-test/`；
  - `node test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs`（默认建 30s timer）；
  - `node test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs --no-trigger`（只部署，手动 `tcb fn invoke`）；
  - env 由 `deploy.mjs` 从 `.anote/frd1/gateway.env` 注入：`TICKET_SECRET`、`DURABLE_WORKER_URL=https://dsh-mini-test.saobao.com`、`SIM_WX_ALARM_TEST=1`
- `SIM_WX_ALARM_TEST=1` 时 `ioLlm` 返回 scripted `sim-final`，不调生产 proxy；`sim_echo` 把计数写到 `state/sim-tool-count-{sid}`。
- Live-B 用真实 oid 但只写 **test bucket**；不写生产桶。`tcb fn detail` 原生命令会明文打印 env；用 `node scripts/dev-cli/index.mjs tcb fn detail sweeper-test`（只报 key）。
- 测试完可 `tcb fn trigger delete sweeper-test tick` 停掉 30s timer；函数保留供下次 Live-B 重跑。

## 7. 证据与边界

- evidence 落 `sim-wx-alarm/evidence/{mode}/{UTC}/`；`result.json`、shots、artifacts 全部 gitignore。
- 截图只在 App session 与 alarm session 对齐时算证据；否则只记状态/接口断言。
- 本 sim 不是 release gate、不接 CI、不建新框架、不建阶段目录。
- 默认 `both` 不写生产桶；Live A 必须显式 opt-in + 清理 + 残留登记。
- `live-pass` 只认手机自己打到 `https://` 的结果。SSH 隧道不参与 live。
- 旧 `sim-alarm-resume` 的 evidence 是历史产物，不随更名重写；新运行使用 `sim-wx-alarm`。
