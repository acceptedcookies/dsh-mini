# durable-state 与 alarm：小程序内 Durable Object 语义模仿方案

> 状态：设计档，待业主点收。本文件是 durable-state 拓扑的**单一登记真源**。
>
> 上游裁决（业主口述，本文件登记）：1. durable state 由 pgs3 承载，位置为 env 内配置的**非用户侧**后端；2. durable alarm 由微信云开发（CloudBase）定时触发器承载 tick。
>
> 参照系：`context/nano-agent` 的 `[session.do]`（`workers/agent-core/` + `packages/session-do-runtime/`）与 `[user.do]`（`workers/orchestrator-core/src/user-do/`）。

---

## 1. 问题陈述

小程序想跑 agentic runtime，缺 Durable Object 的两块地基：

1. **durable state 没有地方存**：`USER_DATA_PATH` 与 `wx.storage` 都是 cache-tier，无 durability 合同（见 `rules/filesystem.md`）。
2. **durable alarm 没有地方唤醒**：JS `setTimeout` 随 app 生命周期死亡，小程序无任何后台唤醒通道。

方案不是「复刻 DO」，而是**用 pgs3（state + CAS + 报警队列）+ CloudBase cron（tick）模拟出 DO 的两个能力**，并如实登记模拟不到的部分。

---

## 2. 拓扑全景

### 2.1 nano-agent 现役拓扑（上游）

```
client
  └─ orchestrator-core (Worker)
       └─ NanoOrchestratorUserDO  [user.do]  每用户一个
            ├─ DO SQLite：durable 行（session truth 投影、deadline 索引）
            ├─ alarm()：多路 sweep（trimHotState / cleanupEnded /
            │   expireStalePending / sweepDetached / sweepOrphanedTurns /
            │   refreshDueOAuth / ensureHotStateAlarm）
            ├─ alarm-scheduler：取最早 deadline → setAlarmIfChanged
            │   （等值 epsilon 去重 + retry floor）
            ├─ WS hibernation：DO 被逐出内存后 socket 仍在，
            │   webSocketMessage 唤醒 → drainForwardFrameBuffer
            └─ turn 恢复链（turn-command-reconcile）：
                stale 命令 → proof-gated（handoff 事件归约 + durable effects
                + turnPumpStatus 活性探测）→ rearm: turnPumpNudge RPC
                ──跨 worker──→ SessionDO.setAlarm(now) → 从 durable cursor 重驱动
       └─ AGENT_CORE (binding-secret gated RPC)
            └─ NanoSessionDO  [session.do]  每会话一个
                 ├─ session-do-runtime substrate：checkpoint/replay、WS/HTTP、remote seam
                 ├─ turn pump 槽位 + durable cursor
                 └─ setAlarm(now) = 「从持久游标重驱动」的原语
```

### 2.2 dsh-mini 模仿拓扑（本案）

```
小程序客户端 (appService, 可随时死)
  ├─ local-runtime：fx wasm + VFS（USER_DATA_PATH cache-tier）
  │    └─ 本地 alarm：仅前台 setTimeout；关闭 → 下次启动 catch-up
  └─ wx.cloud ──→ CloudBase
       ├─ 代理面（已建：openid + 票据 + BYOK 托管）
       │    └─ env: PGS3_URL / PGS3_BUCKET / PGS3_STATE_PREFIX  ← 非用户侧配置
       │         └─ pgs3 (POD1/SYD3 filebucket 或专用实例)
       │              ├─ dsh-mini/state/{openid}/{session_id}   CAS 状态对象
       │              ├─ dsh-mini/claims/{session_id}           单写者租约
       │              └─ dsh-mini/alarms/{due_ts}-{session_id}  报警队列键区
       └─ alarm-sweeper 函数（config.json 单定时触发器，周期 ≈30s）
            └─ 扫描 due 报警 → CAS claim → 调唤醒路径（续跑/清理/通知）
```

**关键边界：客户端永不直连 pgs3。** pgs3 零鉴权（"the listener is the trust boundary"）且小程序有域名白名单；所有 state/alarm 操作走既有代理面，openid 隔离、票据鉴权。env 配置只在服务端，不进客户端包、不进设置页。

---

## 3. DO 语义逐项对照：nano session.do/user.do vs 本案

| DO 语义 | nano-agent 实现 | 本案等价 | 差距定级 |
|---|---|---|---|
| **durable state** | DO SQLite（对象内事务）+ D1 session-truth | pgs3 `objects` 行（单对象 CAS） | **接近**：行级 CAS 可用；缺跨对象事务 |
| **单写者串行化** | DO 运行时硬保证（单执行上下文 + input/output gate） | claim 租约对象 CAS 纪律 | **纪律差**：运行时不管，全靠协议正确执行 |
| **alarm 调度** | `setAlarm(t)` per-object 精确时点，at-least-once | 报警键 + cron 周期扫描，at-least-once | **粒度差**：周期 tick vs 精确时点 |
| **alarm 语义** | 「从 durable cursor 重驱动」 | 同构：claim → 读 state → 续跑 | **同构成立** |
| **alarm 调度器** | `setAlarmIfChanged`：最早 deadline + 等值 epsilon + retry floor | 报警键的 due_ts 即最早 deadline；周期 tick 天然去重 | **同构近似** |
| **WS hibernation** | socket 随 DO 驱逐仍活，`webSocketMessage` 唤醒 | **无等价**：wx socket 随 app 死；服务端→客户端无可靠推送 | **缺失** |
| **热状态** | ~128MB 内存 + hibernation 后仍可唤醒 | 服务端全冷启动，无热状态层 | **缺失**（但有 VFS 本地缓存缓解读侧） |
| **恢复证明** | proof-gated：handoff 事件归约 + durable effects + `turnPumpStatus` 活性探测 | 简化为：state.etag CAS + claim 存在性 + journal fence | **降配但方向一致** |
| **驱逐/死亡** | DO 驱逐只丢内存，alarm 保证有人回来跑 | 函数冷启动等价「全驱逐」；cron 保证 tick 会到 | **同构近似** |
| **延迟** | alarm→wake 区内毫秒 | cron→函数→pgs3→函数 秒级+冷启动 | **差**（agent 场景可接受） |
| **fan-out** | O(1) 定向唤醒 | O(due 报警数)/tick，需分页+批量上限+租约 | **差**（量小可接受） |
| **凭证隔离** | binding-secret + nak_token | openid + 票据（已建管道） | **同构近似** |

### 3.1 三个本质差距，展开说明

**(a) 串行化是纪律不是运行时。** DO 的「同时只有一个执行上下文」是平台保证；我们只有 `If-Match` CAS。因此**所有状态迁移必须走 `读(etag) → 改 → PUT If-Match` 协议**，且前台与 sweeper 都必须先拿 claim 租约（`PUT dsh-mini/claims/{sid}` with `If-None-Match:*`，内含 lease_expires 字段防死锁）。协议错一步即 split-brain，无平台兜底。

**(b) 无跨对象事务 → 状态必须单对象化或 journal 化。** DO SQLite 能一事务改多行；S3 语义下一次 PUT 只碰一个对象。因此会话状态用**单对象快照 + 单调 seq/etag CAS**；多步效果用 **journal 追加 + head 指针对象**（VFS 的 journal/manifest 形状直接复用）。**禁止**把一次逻辑写拆成多个必须同时成功的 PUT。

**(c) alarm 唤不醒客户端。** DO 的 alarm 唤醒的是服务端对象；我们的 cron 也只能唤醒服务端工作。已关闭的小程序没有任何可依赖的拉起通道（订阅消息需用户逐次授权，不可依赖）。所以 alarm 全语义只对 **cloud-runtime** 成立；**local-runtime 的 alarm 合同 = 前台定时器 + 关闭后降级为启动 catch-up**，写进合同不装死。

---

## 4. session.do 专项对比（本案要模仿的核心）

nano `session.do` 的可贵之处不在「有个 DO」，而在三条纪律，本案逐条对应：

| session.do 纪律 | nano 形态 | 本案对应 |
|---|---|---|
| **durable cursor 重驱动** | `setAlarm(now)` → 从持久游标恢复 pump | alarm claim → 读 `state/{openid}/{sid}` → 从 `cursor` 字段续跑 |
| **proof-gated 恢复** | handoff 事件归约 + durable effects + `turnPumpStatus` 探测，四表面一致才动作 | 简化两表面：state 对象 etag + claim 租约；journal `pending/finished/unknown` 圈定未决 |
| **泵活性探测** | 跨 worker `turnPumpNudge` RPC 问「pump 还活着吗」，活着就 rearm 不杀 | sweeper 先 CAS claim 失败 = 「pump 活着」（租约持有中），跳过；claim 成功 = pump 死了或本就该跑 |
| **fencing** | `turnHandoffCommit` CAS `pending→runnable` | state 对象 etag 本身即 fencing token；claim 对象内嵌 fence 代次 |
| **死命令处理** | 证明泵死 → `expire`，证明活着 → `resumed` 顺延 deadline | claim 抢占成功但 state 显示 turn 未结 → resume；state 显示已终态 → claim 即清理 |

**不能模仿的部分**（如实登记）：`turnPumpStatus` 那种「问远端执行体是否存活」的活性 RPC——我们的「执行体」是短生命周期云函数，没有可寻址的长期 actor 可问。等价物降级为「claim 租约是否在有效期内」这一被动证据。这是 DO actor 模型与函数模型的本质差距，已接受。

---

## 5. Case study：六路应用场景推演

### Case A — cloud-runtime 长 turn 跨 app 关闭存活

用户发起分析 turn，服务端 cloud-runtime 执行中，用户关掉小程序。

- nano 对应：SessionDO pump 在 DO 内存继续跑，user.do alarm 兜底 reconcile。
- 本案：cloud 会话的 turn loop 本来就在服务端（代理+runtime），state 对象每步落 pgs3（cursor 推进 + etag CAS）。app 重开 → 拉 `state/{openid}/{sid}` → 从 cursor 续放事件流。
- **本案可达 ≈ 全真**，因为这是纯服务端语义，客户端只是观察者。

### Case B — provider 429 的退避重试

服务端 turn 调 provider 被限流，需 60s 后重试。

- nano：`setAlarm(now+60s)`，DO 醒来重驱动。
- 本案：写 `alarms/{now+60s}-{sid}`（载荷 `{kind:"retry", cursor}`）；sweeper 下两个 tick 扫到 → CAS claim → 续跑函数执行重试 → 更新 state cursor。
- **可达 ≈ 90%**：精度退化到 cron 周期（最坏 +30s 延迟），幂等靠 claim 保证。**接受**：重试本就带 jitter。

### Case C — 会话 TTL / 终态清理

会话 `ended_at` 满 TTL 后清理 state、claims、关联 VFS `cloud-pinned` 对象。

- nano：user.do alarm 里的 `cleanupEndedSessions` / `sweepDetachedSessions`。
- 本案：end 时写 `alarms/{ended+ttl}-{sid}` `{kind:"gc"}`；sweeper claim → 删 state + claims + list `cloud-pinned` 前缀批量 DeleteObjects。
- **可达 ≈ 全真**：清理对延迟不敏感，是 cron 最胜任的场景。

### Case D — local-runtime 前台 alarm 与 catch-up

本地会话调度「30 分钟后提醒/续跑」，用户 10 分钟后关闭 app。

- nano：无此场景（local-runtime 是小程序特有）。
- 本案：前台 `setTimeout` 到期即跑；关闭后 alarm 键仍在 pgs3/本地 journal，**下次启动时 catch-up 扫描**：due 已过 → 立即执行或标记 expired。不承诺后台唤醒。
- **诚实降级**：合同明写 local alarm = best-effort foreground + catch-up。想升级为服务端可唤醒，必须该会话走 cloud-runtime。

### Case E — 双端并发（手机 + iPad 同开一会话）

两个客户端同时对一个 cloud 会话发指令。

- nano：DO 串行化天然拒绝并发写。
- 本案：两端都必须 `If-None-Match:*` 抢 `claims/{sid}`；抢到者写，败者读到「held by device X」→ 退为只读跟随者或提示。claim 带 `lease_expires` 防持方死锁；续租即 CAS 更新。
- **可达 ≈ 80%**：能防并发写，但不能提供 DO 的「输入串行队列」语义——败者是拒绝而非排队。

### Case F — VFS cloud-pinned 对象的异步上行

`/data/{s}` 文件标 `cloud-pinned`，前台只落本地 cache-tier，上行异步。

- nano 对应：placement 属性 + 后台 materialize。
- 本案：写 alarm `{kind:"sync-vfs", path}` 或前台完成即上行；sweeper 兜底补传失败的（journal `pending` 残留）。上行完成 → 行 placement 翻 `cloud-pinned`。
- **协同点**：这就是 `rules/filesystem.md` 留的 seam 第一次真实使用；alarm 队列同时承担「vfs 同步 retry queue」。

---

## 6. 与既有组件的接缝

| 组件 | 接缝 | 说明 |
|---|---|---|
| `services/vfs/` | placement `cloud-pinned`、journal `pending/finished/unknown` | journal 三态是 alarm 幂等的天然判据；`cloud-pinned` 上行由 Case F 驱动 |
| `services/fx/` runtime | `activeDshId` 单会话模型 | 与 claim 租约的「单写者」天然对齐；多会话并发时一会话一 claim |
| 云代理面（已建） | openid + 票据 + env 配置托管 | pgs3 env 与 BYOK env 同托管域；客户端只见 API 不见 S3 |
| `rules/filesystem.md` | placement 档级、S3ObjectBackend 合约 | durable-state 是「比 cloud-pinned 更高一档」的 placement；后端同为 pgs3，但**键区隔离**：vfs 对象走 `vfs/` 前缀，state/alarm 走 `dsh-mini/` 前缀，互不列举 |
| settings 页 S3 占位区 | **不关联** | 那是用户 BYO 语义；durable-state 后端是运营方资产，刻意分离 |
| `cloud/sim` | alarm-sweeper 需要 sim 等价物 | sim 侧用 `setInterval` 扫同一报警队列语义，保持合同同构 |

---

## 7. 进程安排推荐

| 切 | 内容 | 前置 |
|---|---|---|
| **S0** | 本文档点收 + 登记：键区命名（`dsh-mini/state|claims|alarms/`）、CAS 协议、claim 租约形态、local alarm 诚实边界 | 业主确认本文件 |
| **S1** | `S3ObjectBackend` 从占位转正（仅代理面后）：PUT/GET/HEAD/DELETE + If-Match/If-None-Match 透传；env 三件套接入云函数 | S0 |
| **S2** | state 对象 + claim 租约：`readState/writeStateCAS/acquireClaim/releaseClaim` 五件套，服务端 API 面 | S1 |
| **S3** | alarm 队列 + sweeper 函数（`*/30s`，config.json 单触发器）+ claim→dispatch 幂等链 + sim `setInterval` 同构 | S2 |
| **S4** | cloud-runtime 会话接入：turn 每步 cursor 落 state、重试走 alarm 键、TTL 走 gc 报警 | S3 |
| **S5** | local-runtime catch-up：启动时扫本地 journal `pending` + 服务端 due 报警，补触发 | S3（可并行） |
| **S6**（缓议） | 双端并发 UX（跟随者态）、订阅消息通知（用户 opt-in 后）、sweeper 周期自适应 | 业主另行点收 |

**排期理由**：S1-S3 是地基（存储原语+单写者纪律+tick），S4 才是第一个吃到红利的场景（Case A/B/C），S5 补客户端侧诚实边界，S6 全是体验面不急。**禁止在 S2 之前写任何依赖 state 的代码**——没有 CAS 纪律的 durable-state 是假 durable。

---

## 8. 待业主点收清单

1. 键区命名：`dsh-mini/{state,claims,alarms}/` 三段前缀，是否冻入合同；
2. claim 租约：`If-None-Match:*` + `lease_expires` + fence 代次，是否确认形态；
3. sweeper 周期：建议 `*/30s` 起步（官方允许 `*/5s`），是否冻值；
4. local-runtime alarm 合同措辞：「前台定时 + 关闭后 catch-up，不承诺后台唤醒」；
5. pgs3 env 三件套（`PGS3_URL/PGS3_BUCKET/PGS3_STATE_PREFIX`）落在哪个函数/代理的 env，以及 filebucket 共用 vs 专用实例；
6. 是否接受「alarm 仅对 cloud-runtime 全真」这一边界写进用户可见措辞。

---

## 9. 诚实边界汇总（不得越界宣称）

- 串行化是协议纪律，无运行时兜底；协议错一步即 split-brain。
- alarm 粒度 = cron 周期，非精确时点；at-least-once，靠 claim 幂等。
- alarm 唤不醒客户端；local-runtime alarm 仅前台 + catch-up。
- 无跨对象事务；状态必须单对象快照或 journal 化。
- 无可寻址长期 actor；泵活性证据降级为租约存在性。
- sweeper 冷启动 + 跨洲 pgs3 回路 = 秒级到十秒级唤醒延迟，不适合毫秒级场景。
