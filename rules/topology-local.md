# topology-local —— local-runtime 秘钥托管拓扑

> 状态：**设计档 + 落地进度**。
> - L1/L2 云端托管本体仍为**凭证面变更，待业主按 §12 点收**；
> - 已实现并实测：**路由旋钮（三态）+ 本地模拟云端（cloud-sim）**，详见 §13。
> 文档日期 2026-11-04。撰写时事实基线：fx-wasm-agent spike（AG-S1/S2/S3）已在 DevTools 模拟器实测通过；产品第一批 `services/fx/` 已落地并经 `scripts/fx-agentic-test.mjs` 实测 PASS。
> 引用证据等级沿用 test/spike 规范：H1=本机 Node、S1=DevTools 模拟器、host-local-live=本机回环+真实模型路由、sim-local-live=本地模拟云端+真实上游、R=真机（未证）。

## 1. 目标与非目标

**目标**
- 用户（含未登录用户） provider API key 的明文**从不持久驻留设备**，也不进小程序包。
- 密钥使用权绑定微信 openid 认证通道；可选绑定「物理设备 + 生物在场」。
- LLM 请求路径对 `services/fx` 既成实现**零 wasm 改动**——代理只是另一个 OpenAI 兼容 `base_url`。

**非目标**
- 不保护用户免受「本人设备 + 本人已登记指纹」场景的本地滥用（这是设备主语义，可接受）。
- 不声称端到端保密——平台侧（微信云 + 我方云资源）在原理上可解密，除非启用 §8.4 口令档。
- 不替代 nano-agent 远端运行时；这是免登录档的秘钥托管方案，与 nano 对称并存。

## 2. 威胁模型

| 代号 | 威胁 | 现状防护 | 本方案后 |
|---|---|---|---|
| T1 | 包逆向提取（wxapkg 解包，wasm/JS 公开） | 包内无 key（BYOK 在 fetch 边缘注入） | 不变 ✅ |
| T2 | 设备存储窃取（wx.storage 无 keystore） | key 若存设备 = 可提取明文 | **设备无密文明文，密文也在云端** ✅ |
| T3 | 会话劫持 / 异地重放云端调用 | openid 绑定制止跨用户，但同用户会话被盗即可重放 | **SOTER 票据门**：无物理设备+生物在场不发请求权 ✅ |
| T4 | 网络 MITM | TLS（wx.request 强制 https） | 不变 ✅ |
| T5 | 数据库密文泄漏 | —（当前 key 在设备） | 需同时拿到 env 主密钥才可解（信封） ✅ |
| T6 | 平台/运维内部读取 | —— | **诚实红字：原理上可读**（除非口令档） ⚠ |
| T7 | 设备 root/jailbreak 后伪造生物验签 | —— | WeChat verify_signature 对 Android root 场景返回安全降级标志，可据此拒绝 ⚠ |

## 3. services/fx 现状（本拓扑的承载体）

第一批已落地并可被本拓扑直接复用：

```
app.json subpackages[{root:"subpkg/fx"}]
   └─ subpkg/fx/fx-core-async.wasm        zig build -Dwasm-surface=core + wasm-opt --asyncify -Oz（~4.0MB，gitignored 可再生）

services/fx/
   ├─ utf8.ts          UTF-8 编解码兜底（JSC 无 TextEncoder 时）
   ├─ env.ts           宿主能力注入点：WXWebAssembly.instantiate 包装 + wx.request(enableChunked) → fetch/ReadableStream 形态 + 随机数
   ├─ fx-host.ts       wasm 宿主运行时：55 个 WASI/fx import + Asyncify unwind/rewind 驱动 + stdin/stdout 管道
   ├─ acp.ts           ACP+libfx JSON-RPC 客户端：initialize → libfx/new → session/prompt + tool_call/permission/journal_flush 应答
   ├─ runtime.ts       FxLocalRuntime：实现 session-store 的 AgentRuntime 接口；session/update → LocalEvent 投影（delta/tool_call/tool_result/status/approval）
   └─ dev-config.ts    由 scripts/fx-dev-config.mjs 从 .local.development.json 生成（gitignored）
```

**运行时选择**（`session-store.bindRuntime`）：

```
nano 登录 ──► nanoRuntime（远端，WS 会话流）
未登录 ──► FxLocalRuntime.isUsable() ? ── 是 ──► fxRuntime（本档主体）
                                    └─ 否 ──► localRuntime（canned 兜底）
```

**本拓扑的关键接缝**：wasm 内 provider 走 `openai-chat-completions`，其 HTTP 出口是 `env.ts` 的 `wxFetch`——**我们自己的代码**。因此把 `base_url` 从 provider 直连地址换成云端代理地址、并在 fetch 边缘动态注入 `Authorization: Bearer <票据>`，wasm 完全无感。已实测的承载面（ST-S1/S2、AG-S1/S2）即该路径。

## 4. 总体拓扑（视图）

```
                          ┌─────────────────── 微信侧认证域 ───────────────────┐
                          │                                                    │
 ┌──────────┐  wx.login   │   ┌─────────────┐   verify_signature   ┌────────┐ │
 │          │ ──────────► │   │ 云函数(控制面)│ ◄─────────────────► │ 微信    │ │
 │ dsh-mini │  openid     │   │ enroll/unlock │    SOTER 验签        │ 后端   │ │
 │          │ ◄────────── │   └──────┬──────┘                      └────────┘ │
 │ ┌──────┐ │   能力票据   │          │                                        │
 │ │fx.wasm│ │            │          │ 信封加密 + per-openid 记录               │
 │ │(本地) │ │            │          ▼                                        │
 │ └──┬───┘ │            │   ┌─────────────┐                                  │
 └────┼─────┘            │   │ 云数据库     │  {openid, provider, base_url,     │
      │                 │   │ per-openid  │   ciphertext, dek_meta}           │
      │                 │   └──────▲──────┘                                  │
      │  wx.request      │          │                                        │
      │  enableChunked   │   ┌──────┴──────┐                                 │
      │  + Bearer ticket │   │ 云托管(数据面)│                                │
      └─────────────────┼─►│ SSE proxy   │ ────► LLM provider               │
        SSE 流回         │   │ 内存解密/转发  │ ◄──── （上游，用户 key 可用域）   │
                          │   └─────────────┘                                │
                          └──────────────────────────────────────────────────┘
```

**控制面 / 数据面分离**（对原方案的实质增强）：

| 面 | 载体 | 职责 | 为什么选它 |
|---|---|---|---|
| 控制面 | **云函数** | enroll_key / unlock(SOTER验签→发票据) / list / delete | `wx-server-sdk` 直接给 `wxContext.OPENID`（可信 openid，无需自证）；控制面无流式需求，云函数按调用计费够用 |
| 数据面 | **云托管(CloudBase Run)** | 校验票据 → 按 openid 取密文 → 内存解密 → 转发 provider → **SSE 流回** | `wx.cloud.callFunction` 是单次请求/响应且无流式，做不了 SSE；云托管是普通 HTTP 服务，`wx.request enableChunked` 已实测可承载（S1） |

## 5. 秘钥生命周期（视图）

```
[录入一次]
 用户输入 apikey
   │  ┌── SOTER 可用？──否──► 降级策略（见 §9，业主决策项）
   ▼ 是
 startSoterAuthentication(challenge=云端随机串)
   │ resultJSON + signature
   ▼ wx.cloud.callFunction("enroll")
 云函数: verify_signature(openid) ✔ + 新鲜度核对
   │ plaintext apikey（仅存在于函数内存）
   ▼ envelope encrypt:  AES-256-GCM(DEK, plaintext, AAD=openid|provider|record_id)
   │ DEK = HKDF(MASTER_KEY, record_id)      MASTER_KEY 只住云函数 env
   ▼
 云数据库 record { openid, provider, base_url, ciphertext, dek_meta, key_version, created_at }
   ▲ 安全规则: 仅 auth.openid == doc.openid 可读（小程序外无此通道即读不到）

[每次使用]
 解锁: challenge → SOTER 签名 → verify_signature → 签发票据 ticket{openid, exp, jti, scope}
 turn: wx.request → 云托管验票据 → 取 record → 内存解密 → 转发 → SSE 回

[轮换/吊销]
 key_version 字段支持 MASTER_KEY v1→v2 迁移重写
 delete record + 票据 jti 吊销名单（短 TTL 下可省略，仅黑名单异常票据）
 审计: 记录 enroll/unlock/delete 事件（时间、openid、IP、authMode；**绝不记 key**）
```

## 6. 请求时序（视图）

```
小程序(dsh-mini)              云函数              云托管proxy        provider
     │  wx.login → openid        │                   │                │
     │  startSoterAuth(chal) ───►│ verify_signature  │                │
     │◄─── ticket(TTL≈30min) ───│                   │                │
     │                          │                   │                │
     │ fx.wasm: session/prompt  │                   │                │
     │  → fx_http_request       │                   │                │
     │  → env.wxFetch           │ POST /v1/chat/completions           │
     │    +Authorization:ticket ├──────────────────►│ 验签 ticket    │
     │                          │                   │ openid→record  │
     │                          │                   │ 内存解密 key   │
     │                          │                   │───────────────►│
     │                          │        SSE chunks │◄───────────────│
     │  ◄── onChunkReceived ────┼───────────────────┤                │
     │  fx_http_stream_read → wasm → ACP update → UiState 渲染        │
```

**fx 侧改动面（最小化）**：仅 `env.ts wxFetch` 在 `url` 命中代理域时附加票据头；`dev-config` 的 `base_url`/`auth` 生成指向代理。wasm、`fx-host`、`acp`、UI 全部零改动。

## 7. 明文面地图（诚实边界）

| 节点 | key 明文 | key 密文 | 票据 | 说明 |
|---|---|---|---|---|
| 小程序包 | ✗ | ✗ | ✗ | 公开物，永不放秘密 |
| 设备内存/存储 | 仅录入瞬间一次（可再省略：直接录入即转发云端） | ✗ | 内存优先（短 TTL 可放 storage） | 设备上**没有可离线解开的材料** |
| 云函数内存 | 录入/解锁瞬间 | ✗ | 签发 | 瞬时驻留 |
| 云托管内存 | 每请求瞬时 | ✗ | 校验 | 瞬时驻留 |
| 云数据库 | ✗ | ✔（AAD 绑 openid/provider，防跨记录移植） | ✗ | 密文 + 安全规则双保险 |
| env MASTER_KEY | —— | —— | —— | **唯一的长期秘密**；泄漏 → 全量密文可解，故加 key_version 轮换 |

## 8. 分档设计

| 档 | 秘钥保管 | 解锁要求 | 平台可读? | 适用 |
|---|---|---|---|---|
| L0 | 不存（每会话输入） | 无 | 否 | 最高敏感用户 |
| L1（默认） | 云端信封密文 | openid 通道（隐式） | 是 | 普通 BYOK |
| L2 | 云端信封密文 | **+ SOTER 票据** | 是 | 防会话劫持/异地重放 |
| L3 | **用户口令派生 KEK 包封 DEK** | 口令（+可选 SOTER） | **否（真 E2E）** | 隐私极端档；口令不可找回 |

L3 的诚实代价：换设备/忘口令 = key 丢失需重录；移动端口令输入体验差。作为可选档保留。

## 9. 降级与失败矩阵

| 场景 | 行为 | 决策归属 |
|---|---|---|
| 设备无 SOTER / 未登记生物 | 回退 L1（仅 openid）或禁用托管 | **业主决策** |
| DevTools 模拟器（无生物硬件） | 开发档：`.local.development.json` 直连路径保留，不走云端 | 已定（dev 面） |
| verify_signature 服务不可用 | 已有票据 TTL 内继续；到期报「暂时无法解锁」 | 工程项 |
| 云托管不可用 | LLM 路径断；会话/本地功能不受影响；UI 报 retryable error | 工程项 |
| 票据泄漏 | 仅能经代理按该 openid 自己的 key 用；TTL+吊销+限流收敛 | 工程项 |
| Android root | verify_signature 返回安全降级标志 → 拒绝或降级提示 | 业主决策 |
| 用户转 nano 登录 | 秘钥托管可迁移至 nano-platform（同对称档）；匿名记录保留可删 | 业主决策 |

## 10. 工程分期（建议）

```
P0 ✅ 已完成：本地 fx.wasm + BYOK 直连（当前主干）
P1 spike：本地 mock 云托管 proxy（自签票据 + 假信封）→ 证 wxFetch 票据注入 + base_url 切换语义不变（纯本机，零云资源）
P2 施工：云函数控制面(enroll/unlock/delete) + 云托管 SSE proxy + 信封 + per-openid 安全规则 → L1 上线
P3 施工：SOTER 门禁 + 票据 → L2 上线（需 R 车道真机：iOS FaceID + Android 指纹各一）
P4 可选：L3 口令档、key 轮换、审计面板、迁移路径
```

## 11. 诚实边界

- **已证**：分包加载 4MB wasm（S1/AG-S3）；Asyncify 驱动 + 全 import（S1/AG-S1/S2）；wx.request chunked 承载 SSE（S1/ST-S1/S2）；dsh 原生 UI 完整 agentic-chat（devtools-sim + host-local-live）。
- **未证**：真机 iOS/Android 全链路（R 车道未排）；SOTER 在真机的覆盖与验签延迟；云托管 SSE 的长连稳定性与并发配额；`lazyCodeLoading` 下分包冷启动延迟；上传/发布包限对 4MB 分包的验收。
- **不声称**：bio≠加密原语（它是门禁）；云端托管≠端到端秘密（L1/L2 平台原理上可读）；模拟器证据≠真机行为。

## 12. 业主决策清单（施工前需点收）

1. 凭证面扩展批准：云端托管 BYOK key + 能力票据 + SOTER 门禁（本档整体）。
2. 无生物设备的降级策略：回退 L1 / 禁用托管 / 引导口令档。
3. Android root 降级标志的处理：拒绝 / 降级提示。
4. 票据 TTL 与撤销策略（建议 30min + 按需吊销名单）。
5. 云资源归属与成本：appid 云环境开通、云托管常驻规格、SSE 长连计费。
6. 录入路径确认：apikey 是否允许经设备内存一次转发（当前设计即如此），或要求更高档录入方式。

## 13. 落地进度（2026-11-04）

**已实现**

- **旋钮**：`app.json["dsh"].localRuntimeRoute` ∈ `local | cloud | cloud-sim`（`services/fx/route.ts` require app.json 解析，`dev-config.ts` 镜像为 fallback）。
- **云端产物**（部署蓝图，`cloud/`）：`lib/`（envelope AES-256-GCM+HKDF+AAD canonical、ticket HS256 canonical）+ `functions/{enroll,unlock,revoke}` + `proxy/`（CloudBase Run SSE 代理 + Dockerfile，数据面 `ALLOWED_MODELS` 白名单闸）+ `README.md`。
- **本地模拟**：`cloud/sim/server.mjs`（127.0.0.1:3426）同构控制面+数据面 —— challenge/**bio**/enroll/unlock/revoke + `/v1/*` 验票代理；记录存 `os.tmpdir()`；dev 专用 `_` 前缀端点（`_bio` 门禁开关、`_reset` 清库、`status`）。
- **bio 门禁（业主裁决「无 bio 禁止 apikey 注入」）**：`services/fx/enrollment.ts` —— 客户端 `bioStatus` 门（cloud=wx SOTER 双 check / sim=`GET /sim/bio`）+ `collectBioProof`（cloud=`wx.startSoterAuthentication` / sim=`POST /sim/bio` HMAC 证明）；**服务端同样强制验签**（sim=enroll/unlock 验 HMAC 证明+challenge 核销；真云=soter.verifySignature）——客户端禁态只是 UX，服务端独立把关。
- **设置页注入**：`pages/settings` 供应商区 —— 路由感知（local 只读 / cloudish 注入表单）、bio 状态行、base_url+api_key 表单、已注入卡片+撤回；about 区 fx 许可入口（Apache-2.0 · vercel-labs/fx 复制 GitHub 地址）。注入记录非密存 `wx.storage`（provider/base_url/model/时间），api_key 只在 enroll 调用期过内存。
- **模型收敛（业主裁决）**：支持面缩至 `workbuddy/deepseek-v4.1-flash` + `workbuddy/deepseek-v4-pro`；`.local.development.json` catalog/allowed_models 同步收缩，`config.ts MODELS` id 对齐 magpie 路由 id；生效模型=设置页选择（白名单内），切换后 `fxRuntime.restartCore()` 重启 core 生效；服务端 enroll 与数据面均按白名单拒。
- **客户端**：`ticket.ts` 三后端 `ready()` 返回生效 `CredentialSource`（manual 注入 > sim dev 兜底自动注入 > cloud 强制手动 > local dev 直连）；`ensureCore` 按 source 重建 `FX_CONFIGURED_PROVIDERS`/`FX_MODEL`。
- **实测（devtools-sim + sim-local-live）**：`scripts/fx-agentic-test.mjs --enroll-first` 全 PASS —— bio off 禁态断言 → bio on 设置页注入（enroll 带 bio 证明）→ manual 源经代理 deepseek 双轮（text "ok" + get_weather 循环）；curl 负例实证：无证明 enroll→401、非白名单 model→403、bio off 拒签。

**仍未证（原 §11 边界不变）**

- 真云函数/云托管部署与配额、SOTER 真机验签（R 车道）、`wx.cloud` 初始化路径、上传包限。
- sim 与真云的差异面：openid 绑定（sim 固定 dev 租户）、bio 证明签发方（sim 自签 HMAC，真云 TEE）、密钥常量（sim 内嵌 dev 值）。

**旋钮语义表**

| 值 | provider base_url | 票据来源 | 凭证面 | 适用 |
|---|---|---|---|---|
| `local` | `.local.development.json` 直连 | 无 | provider key 直连（dev） | 无云端资源时的开发/兜底 |
| `cloud-sim` | `sim.base_url`（127.0.0.1:3426） | sim HTTP 签发 | dev 常量，同构协议 | 云端方案开发/回归主路径 |
| `cloud` | `cloud.proxy_url` | 云函数+SOTER | 真托管（待业主开通点收） | 生产 |
