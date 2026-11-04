# durable-state 与 alarm：小程序内 Durable Object 语义模仿方案

> 状态：设计档，待业主点收。本文件是 durable-state 拓扑的**单一登记真源**。
>
> 上游裁决（业主口述，本文件登记）：
> 1. durable state 由对象存储承载，落点为 **POD1 filebucket minio**（DF1 官方 object node），位置为 env/secret 内配置的**非用户侧**后端；
> 2. durable alarm 由微信云开发（CloudBase）定时触发器承载 tick；
> 3. **所有到 POD1 的流量经 Cloudflare Worker 转发**，隐藏 POD1 真实位置与内部做法；CF 公网出入口挂备案域名。
>
> 参照系：`context/nano-agent` 的 `[session.do]`（`workers/agent-core/` + `packages/session-do-runtime/`）与 `[user.do]`（`workers/orchestrator-core/src/user-do/`）。
>
> POD1 勘察结论（2026-11-04，只读）：minio.service = filebucket S3，`127.0.0.1:9000` + `wg-nano-link 10.77.0.0/31`，UFW deny-all；MinIO CE RELEASE.2025-10-15；bucket `nano-filebucket`（`df1/ig4/v2/tenant_*` 前缀纪律）；minio-backup 经 wg 复制至 DED1；公网入口为 NPM :443 六条备案域名。

---

## 1. 问题陈述

小程序想跑 agentic runtime，缺 Durable Object 的两块地基：

1. **durable state 没有地方存**：`USER_DATA_PATH` 与 `wx.storage` 都是 cache-tier，无 durability 合同（见 `rules/filesystem.md`）。
2. **durable alarm 没有地方唤醒**：JS `setTimeout` 随 app 生命周期死亡，小程序无任何后台唤醒通道。

方案不是「复刻 DO」，而是**用 POD1 minio（state + CAS + 报警队列）+ CloudBase cron（tick）+ CF Worker（隐藏式门面）模拟出 DO 的两个能力**，并如实登记模拟不到的部分。

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
  │    └─ 本地 alarm：仅前台 interval + 本地 localCas 键区；关闭 → 下次启动 catch-up（扫本地 due 队列）
  └─ wx.cloud ──→ CloudBase
       ├─ 客户端面（已建：openid + 票据 + BYOK 托管）
       └─ alarm-sweeper 函数（config.json 单定时触发器，周期 ≈30s）
            │  HTTPS
            ▼
       CF Worker  [唯一公网入口, 备案子域]
            ├─ auth 闸：验短票/openid → 拒未授权
            ├─ 收窄 API：state/{get|put-cas} claims/{acquire|release}
            │   alarms/{due|claim|ack}  ── 不透传裸 S3
            ├─ 前缀隔离：openid → dsh-mini/state/{openid}/…
            └─ worker secrets 持 S3 key → 内签 SigV4 → fetch
                 │  HTTPS + CF Access service token
                 ▼
            cloudflared (POD1, 纯出站, UFW 零改动)
                 ▼
            minio.service  127.0.0.1:9000
                 └─ bucket nano-filebucket
                      ├─ dsh-mini/state/{openid}/{session_id}   CAS 状态对象
                      ├─ dsh-mini/claims/{session_id}           单写者租约
                      └─ dsh-mini/alarms/{due_ts}-{session_id}  报警队列键区
```

**四层信任边界**：

1. **客户端永不直连 S3，也永不直连 worker**：客户端只见 CloudBase 面（openid+票据）。worker 可被设计为只接受 CloudBase 函数来源（共享 secret 头），公网扫描只见 401/403。
2. **worker 不透传裸 S3**：公网看到的是收窄的 state/alarm API，不是 S3 协议面——「具体做法」藏进 worker。
3. **cloudflared 纯出站**：POD1 防火墙零新增入站；隧道 hostname 前置 Access service token，公网直连 403。
4. **S3 key 只住 worker secrets**：CloudBase 函数、客户端包、设置页全部无凭证。

### 2.3 与上一版（pgs3 直连设想）的差异登记

| 项 | 旧设想 | 本案 |
|---|---|---|
| 后端 | pgs3（零鉴权实验品，字节在 PG） | **POD1 filebucket minio**（DF1 官方 object node，生产级） |
| 传输 | CloudBase 函数直连 S3（不可达，loopback-only） | CF Worker → Access token → cloudflared → minio |
| env 落点 | CloudBase 函数 env | **worker secrets**（`S3_ENDPOINT/S3_BUCKET/S3_KEY/S3_SECRET/STATE_PREFIX`） |
| 公网面 | 未解 | 备案子域，且只暴露收窄 API |
| 条件写 | pgs3 原生 If-Match/If-None-Match | MinIO 条件写**未验证**，L2 矩阵为 S2 硬门 |

---

## 3. DO 语义逐项对照：nano session.do/user.do vs 本案

| DO 语义 | nano-agent 实现 | 本案等价 | 差距定级 |
|---|---|---|---|
| **durable state** | DO SQLite（对象内事务）+ D1 session-truth | minio 对象（单对象 CAS） | **接近**：行级 CAS 待 L2 证实；缺跨对象事务 |
| **单写者串行化** | DO 运行时硬保证（单执行上下文 + input/output gate） | claim 租约对象 CAS 纪律 | **纪律差**：运行时不管，全靠协议正确执行 |
| **alarm 调度** | `setAlarm(t)` per-object 精确时点，at-least-once | 报警键 + cron 周期扫描，at-least-once | **粒度差**：周期 tick vs 精确时点 |
| **alarm 语义** | 「从 durable cursor 重驱动」 | 同构：claim → 读 state → 续跑 | **同构成立** |
| **alarm 调度器** | `setAlarmIfChanged`：最早 deadline + 等值 epsilon + retry floor | 报警键 due_ts 即最早 deadline；周期 tick 天然去重 | **同构近似** |
| **WS hibernation** | socket 随 DO 驱逐仍活，`webSocketMessage` 唤醒 | **无等价**：wx socket 随 app 死；服务端→客户端无可靠推送 | **缺失** |
| **热状态** | ~128MB 内存 + hibernation 后仍可唤醒 | 服务端全冷启动，无热状态层 | **缺失**（VFS 本地缓存缓解读侧） |
| **恢复证明** | proof-gated：handoff 事件归约 + durable effects + `turnPumpStatus` 活性探测 | 简化两表面：state.etag CAS + claim 存在性 + journal fence | **降配但方向一致** |
| **驱逐/死亡** | DO 驱逐只丢内存，alarm 保证有人回来跑 | 函数冷启动等价「全驱逐」；cron 保证 tick 会到 | **同构近似** |
| **执行位置** | DO 在区内，alarm→wake 毫秒 | 链路：sweeper(腾讯)→CF edge→隧道→POD1(波兰)，**每操作 200-350ms** | **差**（state 粗粒度可接受） |
| **fan-out** | O(1) 定向唤醒 | O(due 报警数)/tick，需分页+批量上限+租约 | **差**（量小可接受） |
| **凭证隔离** | binding-secret + nak_token | openid+票据（客户端）+ Access token（链路）+ worker-secret S3 key | **同构近似** |
| **后端鉴权** | DO binding 隐式 | minio SigV4（worker 内签） | **更强**：S3 层自带鉴权 |

### 3.1 三个本质差距，展开说明

**(a) 串行化是纪律不是运行时。** DO 的「同时只有一个执行上下文」是平台保证；我们只有 S3 条件写。因此**所有状态迁移必须走 `读(etag) → 改 → PUT If-Match` 协议**，且前台与 sweeper 都必须先拿 claim 租约（`PUT dsh-mini/claims/{sid}` with `If-None-Match:*`，内含 `lease_expires` 与 fence 代次防死锁）。协议错一步即 split-brain，无平台兜底。**MinIO 条件写支持度是未验证假设**，L2 实测不过则启用备选 fencing（versioning/object-lock 或退回 pgs3）。

**(b) 无跨对象事务 → 状态必须单对象化或 journal 化。** DO SQLite 能一事务改多行；S3 语义下一次 PUT 只碰一个对象。因此会话状态用**单对象快照 + 单调 seq/etag CAS**；多步效果用 **journal 追加 + head 指针对象**（VFS 的 journal/manifest 形状直接复用）。**禁止**把一次逻辑写拆成多个必须同时成功的 PUT。

**(c) alarm 唤不醒客户端。** DO 的 alarm 唤醒的是服务端对象；我们的 cron 也只能唤醒服务端工作。已关闭的小程序没有任何可依赖的拉起通道（订阅消息需用户逐次授权，不可依赖）。所以 alarm 全语义只对 **cloud-runtime** 成立；**local-runtime 的 alarm 合同 = 前台定时器 + 关闭后降级为启动 catch-up**，写进合同不装死。

### 3.2 新增差距：链路延迟形态

DO alarm 是区内毫秒唤醒；本案 sweeper→worker→隧道→POD1 的回路引入 **每跳 200-350ms**，且 sweeper 一次 tick 内的每个 alarm 操作都要付这段回路。因此：sweeper 的单次 dispatch 预算要设上限（如每 tick ≤N 个 claim、超时即让下次 tick 接管）；alarm 到期精度的实际下界 = cron 周期 + 回路延迟，按 `30s + ~1s` 量级设计，不承诺秒级精确。

---

## 4. session.do 专项对比（本案要模仿的核心）

nano `session.do` 的可贵之处不在「有个 DO」，而在三条纪律，本案逐条对应：

| session.do 纪律 | nano 形态 | 本案对应 |
|---|---|---|
| **durable cursor 重驱动** | `setAlarm(now)` → 从持久游标恢复 pump | alarm claim → worker `state/get` → 从 `cursor` 字段续跑 |
| **proof-gated 恢复** | handoff 事件归约 + durable effects + `turnPumpStatus` 探测，四表面一致才动作 | 简化两表面：state 对象 etag + claim 租约；journal `pending/finished/unknown` 圈定未决 |
| **泵活性探测** | 跨 worker `turnPumpNudge` RPC 问「pump 还活着吗」，活着就 rearm 不杀 | sweeper 先 CAS claim 失败 = 「pump 活着」（租约持有中），跳过；claim 成功 = pump 死了或本就该跑 |
| **fencing** | `turnHandoffCommit` CAS `pending→runnable` | state 对象 etag 本身即 fencing token；claim 对象内嵌 fence 代次 |
| **死命令处理** | 证明泵死 → `expire`，证明活着 → `resumed` 顺延 deadline | claim 抢占成功但 state 显示 turn 未结 → resume；state 显示已终态 → claim 即清理 |

**不能模仿的部分**（如实登记）：`turnPumpStatus` 那种「问远端执行体是否存活」的活性 RPC——我们的「执行体」是短生命周期函数（CloudBase）与无态 worker，没有可寻址的长期 actor 可问。等价物降级为「claim 租约是否在有效期内」这一被动证据。这是 DO actor 模型与函数模型的本质差距，已接受。

---

## 5. Case study：六路应用场景推演（新拓扑下重解析）

以下每个 case 标出：执行体在哪、走哪条链、用什么原语、可达度与代价。

### Case A — cloud-runtime 长 turn 跨 app 关闭存活

用户发起分析 turn，服务端执行中，用户关掉小程序。

- nano 对应：SessionDO pump 在 DO 内存继续跑，user.do alarm 兜底 reconcile。
- 本案路径：turn 执行体（在 CloudBase 侧函数或后续 service）每步经 worker `put-cas` 落 state（cursor 推进 + etag CAS）。app 重开 → 客户端经 cloud 面 → worker `state/get` → 从 cursor 续放事件流。
- 原语：state CAS 写 + state get；claim 租约防止前台与 sweeper 双写。
- **可达 ≈ 全真**：纯服务端语义，客户端只是观察者。代价：每步状态落盘付一跳 200-350ms → **cursor 按批落盘**（每事件帧不逐条写，按 turn-step 边界写）。

### Case B — provider 429 的退避重试

服务端 turn 调 provider 被限流，需 60s 后重试。

- nano：`setAlarm(now+60s)`，DO 醒来重驱动。
- 本案路径：执行体写 `alarms/{now+60s}-{sid}`（载荷 `{kind:"retry", cursor}`，经 worker `alarms/due`）；sweeper 下一 tick 扫到 → worker `alarms/claim`（CAS 删除/标记）→ 派发给重试执行体 → `state/put-cas` 更新 cursor。
- 原语：alarm 键 CRUD + claim CAS。
- **可达 ≈ 90%**：精度退化 = cron 周期 + sweeper→POD1 回路（最坏 +31s 量级）。重试本就带 jitter，接受。

### Case C — 会话 TTL / 终态清理

会话 `ended_at` 满 TTL 后清理 state、claims、关联 VFS `cloud-pinned` 对象。

- nano：user.do alarm 里 `cleanupEndedSessions` / `sweepDetachedSessions`。
- 本案路径：end 时写 `alarms/{ended+ttl}-{sid}` `{kind:"gc"}`；sweeper claim → 调 worker：删 state + claims + `ListObjectsV2(dsh-mini/vfs/{sid}/)` 批量 DeleteObjects。
- 原语：alarm claim + 多键删除（注意 §3.1(b)：删除允许逐键，终态只要求最终一致）。
- **可达 ≈ 全真**：清理对延迟不敏感，是 cron+对象存储最胜任的场景。

### Case D — local-runtime 前台 alarm 与 catch-up

本地会话调度「30 分钟后续跑」，用户 10 分钟后关闭 app。

- nano 对应：无（local-runtime 是小程序特有）。
- 本案路径（MN01 T-O-9 已冻结，修正原"总是写云端"表述）：**local 车道 alarm 键写本地 localCas**（`dsh-mini/alarms/local/{dueAt}-{sid}`，wx.storage 替身——本地键区与云端是两个独立后端，不互见）。前台 `onShow` 30s interval 到期正常跑；`onHide` 停 interval 并落 `pending-catchup` 标记；**下次启动 catch-up**：`onLaunch` 扫 localCas due alarm → 恢复 turn 续跑。本地会话的 alarm 不上行（本地 turn 状态本就只住本地——单一真源：哪条车道的状态由哪条车道管）。
- 原语：alarm 写 + due 查询；worker 侧按 openid 前缀隔离保证只见自己的报警。
- **诚实降级**：local alarm = best-effort foreground + catch-up；不承诺后台唤醒。想升级必须该会话走 cloud-runtime。

### Case E — 双端并发（手机 + iPad 同开一会话）

两个客户端同时对一个 cloud 会话发指令。

- nano：DO 串行化天然拒绝并发写。
- 本案路径：两端都经 cloud 面 → worker `claims/acquire`（`If-None-Match:*`）。抢到者获得写权+ fence 代次，败者读到「held by device X」→ 退为只读跟随者或提示。claim 含 `lease_expires` + 续租即 CAS 更新；持方崩死则租约到期自然释放。
- 原语：claim CAS + lease 字段。**全链路两个 CAS 往返 ≈ 1s 级**，抢占是一次性成本，可接受。
- **可达 ≈ 80%**：能防并发写，但不提供 DO「输入串行队列」语义——败者是拒绝而非排队。

### Case F — VFS cloud-pinned 对象的异步上行

`/data/{s}` 文件标 `cloud-pinned`，前台只落本地 cache-tier，上行异步。

- nano 对应：placement 属性 + 后台 materialize。
- 本案路径：上行直接走 cloud 面 → worker `vfs/` 前缀 PUT（与 state 不同键区）。失败的挂 `alarms/{retry}-{sid}` `{kind:"sync-vfs", path}`，sweeper 兜底重传；行 placement 翻 `cloud-pinned` 即闭环。
- 原语：对象 PUT + alarm 兜底 + VFS journal `pending` 圈定未决上传。
- **协同点**：`rules/filesystem.md` 留的 S3 seam 首次真实使用；**对象字节与 state 走同一后端不同前缀**，worker 内按键区做差异化鉴权（vfs 前缀允许较大 body、state 前缀限小 body）。

---

## 6. 与既有组件的接缝

| 组件 | 接缝 | 说明 |
|---|---|---|
| `services/vfs/` | placement `cloud-pinned`、journal 三态、ObjectBackend | journal `pending/finished/unknown` 是 alarm 幂等判据；`S3ObjectBackend` 的真实后端 = 本案 worker 面（不是裸 S3 endpoint） |
| `services/fx/` runtime | `activeDshId` 单会话模型 | 与 claim 单写者天然对齐；多会话并发时一会话一 claim |
| CloudBase 客户端面（已建） | openid + 票据 + BYOK env 托管 | worker 只验票不建身份；openid custody 留在 CloudBase |
| `cloud/sim` | sweeper 需要 sim 等价物 | sim 侧 `setInterval` 扫同一 alarm 语义 + 本地 stub 版 worker API，保持合同同构 |
| `rules/filesystem.md` | placement 档级、S3 seam | durable-state 是比 `cloud-pinned` 更高一档的 placement；同后端、`dsh-mini/` vs `vfs/` 键区隔离 |
| settings 页 S3 占位区 | **不关联** | 用户 BYO 语义 ≠ 运营方 state 后端，刻意分离 |
| POD1 minio-backup | 既有 wg→DED1 复制 | durability 叙事现成：对象层自带跨站备份车道，非本案新建 |

---

## 7. 进程安排推荐

| 切 | 内容 | 前置/门 |
|---|---|---|
| **S0** | 本文档点收：拓扑、键区、claim 形态、cron 周期、local 合同措辞 | 业主确认 |
| **S1** | **MinIO L2 CAS 实测**（`scripts/s3-probe.mjs`，probe key 可逆测试）：`If-None-Match:*`→412、`If-Match` etag、并发恰好一胜、`If-None-Match:{etag}`；同时验证 ListV2/Range/multipart | **硬门**：CAS 不过 → 备选 fencing（versioning/object-lock）或退回 pgs3，不许带病施工 |
| **S2** | POD1 侧：cloudflared + Access service token + 隧道 hostname 上线（业主 live 操作） | S1 |
| **S3** | CF Worker：收窄 API（state/claims/alarms/vfs-put）+ 验票 + openid 前缀隔离 + 内签 SigV4；sim 等价 stub | S2 |
| **S4** | state+claim 五件套服务端 API 联调 + CloudBase sweeper 函数（`*/30s` 单触发器）+ claim→dispatch 幂等链 | S3 |
| **S5** | cloud-runtime 会话接入：cursor 批量落 state、重试走 alarm、TTL 走 gc | S4 |
| **S6** | local-runtime catch-up + Case F 的 cloud-pinned 上行 | S4 |
| **S7**（缓议） | 双端并发 UX、订阅消息、sweeper 周期自适应、worker 直供客户端（省 CloudBase 一跳） | 业主另行点收 |

**排期理由**：S1 是存在性验证（CAS 不行则全局改方案），S2-S3 是门与面，S4 才形成 DO 语义的完整闭环，S5/S6 吃红利。**禁止在 S3 之前写任何依赖远端 state 的客户端代码**。

---

## 8. 待业主点收清单

1. 键区命名：`nano-filebucket` 下 `dsh-mini/{state,claims,alarms}/` 与 `dsh-mini/vfs/`，与既有 `v2/tenant_*` 前缀纪律的关系（并列新前缀 vs 挂 v2 之下）；
2. claim 租约形态：`If-None-Match:*` + `lease_expires` + fence 代次；
3. sweeper 周期：`*/30s` 起步冻值（官方下限 `*/5s`）；
4. local-runtime alarm 合同措辞：「前台定时 + 关闭后 catch-up，不承诺后台唤醒」；
5. worker secrets 五件套命名（`S3_ENDPOINT/S3_BUCKET/S3_KEY/S3_SECRET/STATE_PREFIX`）与 probe key 发放方式；
6. 备案子域选名（`mini-s3.haimang.com.cn` 或同级）与 Access token 生命周期管理；
7. 「alarm 仅对 cloud-runtime 全真」的用户可见措辞；
8. 若 MinIO CAS 实测不过：备选 fencing 的取舍（versioning vs pgs3 回退）。

---

## 9. 诚实边界汇总（不得越界宣称）

- 串行化是协议纪律，无运行时兜底；协议错一步即 split-brain。
- MinIO 条件写未验证，S1 是硬门。
- alarm 粒度 = cron 周期 + 跨洲回路，非精确时点；at-least-once，靠 claim 幂等。
- alarm 唤不醒客户端；local-runtime alarm 仅前台 + catch-up。
- 无跨对象事务；状态必须单对象快照或 journal 化。
- 无可寻址长期 actor；泵活性证据降级为租约存在性。
- 每次 state 操作付 200-350ms 跨洲回路 + worker/函数冷启动；不做毫秒级场景。
- POD1 单点：「隐藏」≠「冗余」；对象层靠既有 wg→DED1 备份车道，state 可用性仍系单机。
- worker 请求体/子请求配额决定对象尺寸上限；大对象不走此道。
