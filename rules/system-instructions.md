# system-instructions —— 上下文组件模型与双 runtime 注入拓扑

> 状态：设计档，待业主点收。本文件是 system-instructions（系统提示词/上下文注入）拓扑的**单一登记真源**。
>
> 上游裁决（业主口述，本文件登记）：
> 1. local-runtime 的默认 persona **照 dsh 移植**——dsh 现有的 persona 机制即本地默认；
> 2. cloud-runtime 的 persona 走 **NACP 协议车道**（instruction profile 服务端生产）；local 与 cloud **分开**——cloud 载入的是 cloud 的生产；
> 3. instruction 生命周期**按 nano-agent 的实现**进行；
> 4. 本地合约与 context 真源走**独立分包载入**——非首屏必需，降低首屏加载压力；
> 5. 组件集先构建 **NACP 协议约束下的必要子集**，保持兼容、可按 NACP 要求继续伸缩。
>
> 参照系：`context/nano-agent`（`packages/nacp-session/src/context-component-registry.ts` + `workers/agent-core/src/host/llm-bridge/`）、`context/fx`（`src/acp/` + `src/wasm_core_main.zig`）、`context/deepseek-harness`（`packages/core/system-prompt` + `packages/core/agent-loop` + `packages/preset/persona`）。
>
> 同族文档：`rules/filesystem.md`（VFS）、`rules/durable-state.md`（durable 语义）、`rules/topology-local.md`（秘钥托管）。

---

## 1. 心智模型（先读这个）

**一句话：上下文的心智模型 = nano-agent；执行底座 = fx wasm 的接缝；体验层 = dsh。**

| 参照系 | 在 dsh-mini 里的角色 | 明确不采纳的部分 |
|---|---|---|
| **nano-agent** | **唯一上下文心智模型**：`(context_layer, kind)` 身份戳记组件、strip-then-inject、固定座位序、单一文案源、冻结语义 | 编译期 literal-zero 闸门、Workers 侧基础设施 |
| **fx** | **传输接缝**：wasm 核心是一张白纸，全部 model-visible 文本经它暴露的 ACP 槽位注入 | fx 自己的 prompt 流水线心智（`buildProviderPrompt` 分层）不进入本地语义 |
| **dsh** | **体验层**：session 面以 dsh 形态呈现 system/context 条目；**本地默认 persona 的机制与文案源** | dsh 的 cordis 注册表模型（scope 树、effect/disposable、`{{var}}` 插值管线）不在本地复刻 |

**推论**：local-runtime 与 cloud-runtime 不是两套机制——是**同一组件集在两个传输面上的投影**。差异只在：哪些组件由本地装配、哪些由服务端戳记。

---

## 2. 三者机制对照分析

### 2.1 dsh：声明式注册表 + durable surface

`ctx.systemPrompt` 五类注册面：`section()`（有序文本段，`(order, name)` 排序）、`context()`（动态上下文→独立 user-role 快照）、`tools()`、`variable()`（`{{var}}` 严格插值）、`suppressRuntimeContext()`；外加 `agent.ctx` scoped 同名遮蔽、`complete: true` 独占、`system-prompt/assemble` waterfall、`systemPromptUpdate:'in-history'` 续传追加。

**关键设计**：系统提示词经 `session.append('system/message')` 成为 durable surface node 0（`packages/core/agent-loop/src/runtime-context.ts` 的 `SystemPromptProjection`），运行时上下文是带 `runtime-context` source kind 的 user 消息——**model-visible ⟺ 已记档**。本地采纳的是它的「session 面表达形态」，不是注册表本身。

### 2.2 fx：命令式流水线 + wasm 空核心

非 wasm 侧 `buildProviderPrompt` = `stable_prefix`（system_prompt → custom_tool_guidance → skill_catalog → host_instructions → model_prompt_overlay → static context）+ ephemeral overlay + history + 轮内后缀；变化以 `<fx-context-update>` 搭车，前缀 turn 内冻结。

**wasm 核心是白纸**（`src/wasm_core_main.zig:58,67`）：

```zig
.prompt_policy = .{ .system_prompt = "" },
.context_registry = .{ .default_provider = context_contract.empty_provider },
```

即 wasm 上基础提示词、项目上下文、transient runtime context **全部为空**。ACP 面实际可用槽位（`src/acp/server.zig:2759-2764`、`sessions.zig:118-238`）：

| 槽位 | 位置 | 约束 |
|---|---|---|
| `clientCapabilities.libfx.instructions` | `initialize`（进程级 `state.host_instructions`） | 单字符串 ≤64KiB；落稳定前缀 `<client_instructions>` 块 |
| `clientCapabilities.libfx.tools` | `initialize` | name/description/inputSchema，无独立 guidance 字段 |
| `session/new` `systemPrompt` | **wasm 不可达**——wasm 路由到 `handleNewWasmSession`，不解析（`sessions.zig:179-238`；非 wasm `session/new` 才走 `client_instructions.parse`） | — |
| `libfx/new` `systemPrompt` | **不存在**——`handleNewLibfxSession` 只读 sessionId/hooks | — |
| `session/prompt` content blocks | 每轮 | user-role 文本/图片 |
| `libfx/tool_call` 返回文本 | 每次工具应答 | model-visible，fx 不解析内部约定块 |
| `libfx_steer` / `libfx_follow_up` | 轮内 | user-role 搭车 |

**结论**：fx wasm 上 100% 的系统提示词等价物只能经 `libfx.instructions` + prompt 前导块注入。这是事实约束，不是选择。

### 2.3 nano-agent：身份戳记组件管道

每条 model-visible 消息带 `(context_layer, kind)` 身份（`context-component-registry.ts`），注入函数按固定嵌套序执行 **strip → inject**（`llm-call/contract.ts:229-236`）：

```
canonical_system_prompt ──prepend──► (adapted messages)
  → model_steering        （canonical 后，per-model 冻结行）
  → instruction_profile   （instruction zone 尾，快照 {task_key,digest,binding_epoch}）
  → skill_catalog         （canonical + 整个 instruction zone 之后，不入 zone 内）
  → initial_context → memory → history → current_turn → tail carriers(todo)
```

- `withNanoAgentSystemPrompt`：剥离全部 canonical → 重渲染（或 `canonicalTextOverride` 冻结字节，scope=modelId，冲突即 fail closed）→ prepend 恰好一条（idempotent）。
- `withInstructionProfileSystemMessage`：剥旧 → 要求 canonical 存在 → 一条 durable 快照入座。
- `withSkillCatalogSystemMessage`：剥旧 → 坐 canonical + instruction zone 之后（`skill-catalog-component.ts:60-72`）。
- 平台文案全部出自编译期 `SYSTEM_TEXT_UNITS` 源表（`nacp-core/src/system-text/source.ts`）：`unit_id`/`claim_class`/`truth_carrier`/`introduced_by` 闭集字段，手写副本 = literal-zero 违规。

---

## 3. 裁决登记（R1–R5 展开）

### R1 — 本地 persona = dsh 移植

dsh 仓内 persona 是**机制不是文案**：`personaPrefix`/`personaSuffix` 默认空（`system-prompt/src/index.ts:439-440`），由部署/preset 填充；`packages/preset/persona` 提供 scoped 遮蔽行（prefix/suffix/`complete`/`includeRuntimeContext`）。

**本地移植面**：
- `instruction_profile` 座位在本地由 **deployment-authored persona** 填充——机制等价物 = dsh 的 prefix/suffix 双槽 + `complete`（独占 head 区其余组件）+ `includeRuntimeContext`（抑制会话/turn 级快照）+ session-scoped 遮蔽；
- 本地发货默认 = dsh harness identity（`You are an AI agent powered by DeepSeek Harness.`）+ dsh-mini 部署 persona 占位文案（文案本身见 §11 待点收）；
- **scope 粒度登记**：本地无 cordis scope 树，遮蔽只到 **session 粒度**（每会话一份 persona 行，覆盖部署默认）。

### R2 — cloud persona = NACP 生产，双轨分开

- cloud-runtime 的 `instruction_profile` 由服务端按租户 instruction profile 戳记（`instruction-profile-component.ts`），本地只上送绑定引用/occupancy 字段；
- **local 不拉取云端 profile、cloud 会话不注入本地 persona**——同一 kind、不同权威（local: deployment-authored；cloud: tenant server）；运行时切换时 persona 随 runtime 换，不残留、不合并。

### R3 — 生命周期照 nano 实现

| nano 语义 | 本地映射 |
|---|---|
| 每请求 strip → inject（按身份，非文本） | 每次注入前**全量重渲染该座位**，不追加 delta——幂等来自重算而非 diff |
| `canonicalTextOverride` 冻结字节（turn 内，scope=modelId） | head 区组件在 prompt 提交时快照，**turn 内冻结**（fx 前缀本就冻结——双重对齐）；turn 后变更进下一次快照 |
| IP durable 快照 `{task_key, digest, binding_epoch}` | persona 行携带 `{key, digest, epoch}`；变更 bump epoch，**会话激活时绑定**，turn 内不回溯 |
| `with*` 要求 canonical 存在才入座 | 无 canonical 则整个 head 区不装配（canonical 是必要组件，恒在） |
| strip 失败/身份冲突 fail closed | 组件身份冲突（同 kind 双实例、未知 kind）**装配即抛错**，不产出半成品提示词 |

**本地落地形态**：`libfx.instructions` 是进程级 → head 区装配发生在 **session 激活**；若新装配的 head digest ≠ 核心内现役 digest → `restartCore()` + 重新 `initialize`（fx wasm 单 active session 模型使这合法）。会话/turn 级组件每次 `session/prompt` 全量重渲染前导块。

### R4 — 独立分包载入

- context 合约 + 文案真源 + 装配器 + persona 文案全部进 **`subpkg/context/`** 分包（与 `subpkg/fx` 同形制）；
- 主包只留薄壳：分包懒加载（首个 session 创建时触发）、consumption receipt 投影、runtime adapter 接口；
- **首屏路径禁止 import 分包内任何符号**——分包体积不受首屏预算约束，但加载时机受 session 生命周期约束。

### R5 — NACP 约束下的必要子集

v1 组件集（kind 与 nano registry 同名同层，未来按 NACP 扩）：

| kind | layer | role | 权威 | 生命周期 | v1 |
|---|---|---|---|---|---|
| `canonical_system_prompt` | system | system | platform | frozen_per_turn，恒在 | ✅ |
| `model_steering` | system | system | platform | frozen_per_turn，per-model 可空 | ✅（默认空） |
| `instruction_profile` | system | system | deployment(本地)/tenant(云) | durable 快照 {key,digest,epoch} | ✅ |
| `mode_policy` | system | system | deployment 供文案 + runtime 决活态 | per-assembly 条件渲染（dsh `plan:policy` 同构） | ✅ |
| `skill_catalog` | system | system | platform | per-assembly 可空 | ✅（默认空） |
| `tool_schema` | system | — | platform | 经 `libfx.tools`/NACP tools 字段 | ✅ |
| `initial_context` | session | system→本地降级 user 块 | client | first-prompt 快照 | ✅ |
| `memory` | session | system→本地降级 | client/server | durable 投影 | ✅（v1 可空壳） |
| `file_focus` | turn | system→本地降级 | client | per-prompt | ✅ |
| `runtime_notice` | turn | system→本地降级 | runtime | per-prompt | ✅ |
| `todo` | turn | tail carrier | runtime | per-prompt 尾挂 | ✅ |
| `transcript_summary` / `compact_boundary` 等 compaction kinds | session | — | runtime | — | 预留（不入 v1） |

闭合枚举——**未登记的 kind 装配即抛错**；新增 kind 必须先登记本文件 + 合约再实现。

---

## 4. 拓扑全景

```
dsh-mini
├─ app.json
│   └─ subpackages[ { root:"subpkg/fx" }, { root:"subpkg/context" } ]   ← 裁决4
│
├─ subpkg/context/                          ← 分包：合约 + 真源 + 装配
│   ├─ contract.ts        ContextLayer/ContextKind 闭合枚举、ContextComponent 类型、
│   │                     COMPONENT_SEATS 座位表、COMPONENT_AUTHORITY 权威表
│   ├─ units.ts           CONTEXT_TEXT_UNITS 文案源表（nano SYSTEM_TEXT_UNITS 形制：
│   │                     unit_id/claim_class/truth_carrier；本地 persona 文案也在此）
│   ├─ assemble.ts        座位装配器：strip→inject（按身份重渲染）、frozen 快照、
│   │                     persona 遮蔽（scoped persona 覆盖 deployment 默认）、
│   │                     complete/includeRuntimeContext 语义
│   └─ seats.ts           →fx / →nacp 两个投影器（组件集 → 各传输面载荷）
│
├─ services/context/                        ← 主包薄壳（不进分包）
│   ├─ index.ts           懒加载 subpkg/context；暴露 assembleFor(runtime, session)
│   └─ receipt.ts         consumption receipt 投影：{kind,digest,seat,consumed_at} →
│                         session 面 system/context 条目（dsh 形态）
│
├─ services/fx/                             ← local-runtime 接缝（已有，扩）
│   ├─ acp.ts             initialize 增 libfx.instructions；tools 已通
│   └─ runtime.ts         session 激活时装配 head 区；session/prompt 注入前导块
│
└─ services/nano/                           ← cloud-runtime 接缝（已有，扩）
    └─ runtime.ts         client-owned 组件 → NACP 请求字段；服务端组件不入本地装配
```

**数据流（local）**：

```
session 激活 ──► assemble(head 区组件集) ──► seats.fx() ──► libfx.instructions
   │                                                        (digest 变 → restartCore+initialize)
   └─► receipt ──► session 面「system」条目

session/prompt ──► assemble(tail 区组件集) ──► 前导文本块 + 用户输入 ──► fx
                    └─► receipt ──► session 面「context」条目
```

**数据流（cloud）**：`assemble(client-owned)` → `seats.nacp()` → NACP 请求字段；platform/tenant-owned 组件由服务端戳记，本地仅留 receipt，**不复制其字节**。

---

## 5. 统一 typed 合约（v1 骨架语义）

```ts
// subpkg/context/contract.ts —— 全部闭合集，未知值即错
type ContextLayer = 'system' | 'session' | 'turn'
type ContextKind  = /* §3 R5 表内全集，含预留位 */
type ComponentAuthority = 'platform' | 'tenant' | 'deployment' | 'client' | 'runtime'

interface ContextComponent<K extends ContextKind = ContextKind> {
  layer: ContextLayer
  kind: K                                // 身份 = (layer, kind)，不从文本推断
  role: 'system' | 'user'
  body: string                           // model-visible 字节；tool_schema 除外
  identity: { key?: string; digest?: string; epoch?: string }
  frozenPerTurn: boolean
}

const COMPONENT_SEATS: readonly ContextKind[] = [
  'canonical_system_prompt', 'model_steering', 'instruction_profile',
  'mode_policy', 'skill_catalog', 'initial_context', 'memory',
  /* history 由 runtime 自供，不在组件集内 */
  'file_focus', 'runtime_notice', /* current_turn */ 'todo',
]
```

三条硬约束：

1. **单一文案源**：凡 model-visible 的平台/部署文案必须出自 `units.ts` 源表（`unit_id`/`claim_class`/`truth_carrier` 必填），代码其余位置出现手写提示词文本 = 违规（纪律照 nano `T-O-SLR-02`，不复制其编译闸门）；
2. **身份即合同**：组件以 `(layer, kind)` 寻址与剥离；任何按文本前缀/内容猜测身份的行为 = 违规（照 `skill-catalog-component.ts:17-25`）；
3. **座位不可乱**：组件入座序以 `COMPONENT_SEATS` 为准；本地因 fx 接缝折叠消息边界时，**字节序仍按座位序**。

### 5.1 模式：dsh 模式三件套 → 本地映射

dsh 的「模式」（plan-mode 为范例）本质是**系统提示词机制的条件用法**——条件 section + `when:` 条件工具 + session 投影状态。本地按组件语义复刻，不复刻 cordis 机制：

| dsh 构成 | 范例（`packages/plan/plan-mode`） | 本地等价 |
|---|---|---|
| 条件 section | `plan:policy` @500，`text:(ctx)=>active?guidance:''`（index.ts:197-204） | `mode_policy` 组件：`modeState` 为活则渲染 units 文案，否则整组件缺席 |
| 模式状态事实 | `SANDBOX_POLICY`/`APPROVAL_POLICY` context @110/115 | 会话/turn 区组件（`runtime_notice` 或专用 context 组件） |
| 条件工具 | `exit_plan_mode` `when:` 门（index.ts:375） | `tool_schema` 集合随 `modeState` 变化——**见 §6.1 约束** |
| 状态载体 | `plan/mode` 日志 + `plan` projection | modeState 存 session 自有状态（durable-state 档），随会话折叠/恢复 |
| 切换时机 | `pendingIntents` → 下一 `agent/pre-step` 提交 | **模式选择排队至下一 prompt 边界生效**——与 R3「提示词只在请求边界变化」同一条纪律 |

**模式集合本身登记于合约**：`mode` 是闭合枚举（v1 至少含 `default`、`plan`），每种模式映射其 `mode_policy` 文案 unit + 工具准入差集 + context 事实集；新增模式 = 新枚举值 + 新 unit，不得散写。

---

## 6. 接缝映射表

### 6.1 → fx（local-runtime）

| 组件区 | fx 槽位 | 说明 |
|---|---|---|
| head 区（canonical→steering→profile→**mode_policy**→catalog） | `initialize` 的 `libfx.instructions` | 座位序串行化进单串；digest 变 → restartCore |
| `tool_schema` | `libfx.tools` | 已通；tool guidance 折进 description 或 head 区 unit（fx 无独立 guidance 槽） |
| session 区（initial_context/memory） | 首个 `session/prompt` 前导文本块 | 仅内容变化时重发 |
| turn 区（file_focus/runtime_notice/todo） | 每次 `session/prompt` 前导/尾随文本块 | 全量重渲染 = strip-then-inject |
| 工具结果载文 | `libfx/tool_call` 返回文本自带约定块 | fx 透传，模型可见 |

### 6.2 → NACP（cloud-runtime）

| 组件 | NACP 面 | 说明 |
|---|---|---|
| `instruction_profile` | 租户 profile 绑定引用（occupancy/binding 字段） | **不上送本地 persona 字节** |
| `initial_context` / `file_focus` / 工具结果 | 请求合同对应字段 | client-owned |
| `runtime_notice` | turn ingress 位 | runtime-owned 时注意由服务端或本地 runtime 产，不双写 |
| platform-owned（canonical/steering/catalog） | **不映射** | 服务端戳记；本地只留 receipt |

### 6.3 → session 面（dsh UI 形态）

每次实际注入产 consumption receipt：`{kind, digest, seat, consumed_at}`——对齐 nano receipt 纪律与 dsh「model-visible ⟺ 已记档」。UI 从 receipt 流渲染 system/context 条目；**receipt 不含可执行 payload、不作恢复读源**。

---

## 7. 与既有组件的接缝

| 组件 | 接缝 | 说明 |
|---|---|---|
| `services/fx/acp.ts` | initialize 载荷 | 增 `instructions` 字段；`libfx.tools` 已通 |
| `services/fx/runtime.ts` | session 激活点 + prompt 提交点 | head 装配→instructions；tail 装配→前导块；restartCore 已存在可复用 |
| `services/nano/runtime.ts` | NACP 请求构建 | client-owned 组件字段映射；不新增 lane |
| `services/vfs/` | initial_context/file_focus 内容源 | VFS cwd、锚定文件投影进会话/turn 级组件 |
| `session-store` | receipt 归并与 UI 投影 | receipt 流进 session 面，与 LocalEvent 同轨 |
| `app.json` | `subpkg/context` 分包登记 | 主包零静态依赖 |
| `rules/durable-state.md` | persona 行/IP 快照的 durable 存放 | 本地 persona 行属 deployment 态，可随包发；用户自定义 persona 若有持久化需求走该档的 state 面 |

---

## 8. 进程安排推荐

| 切 | 内容 | 门 |
|---|---|---|
| **S0** | 本文档点收：心智模型、R1–R5、座位表、接缝映射、分包边界 | 业主确认 |
| **S1** | `subpkg/context` 合约骨架：枚举/类型/座位表/units 空表 + 装配器纯函数（无 fx/nano 依赖，可单测） | S0 |
| **S2** | `seats.fx()` + `services/fx` 接线：instructions 注入、prompt 前导块、digest→restartCore | S1；`fx-agentic-test` 历史实测（脚本已拆除） |
| **S3** | receipt 投影 → session 面 dsh 形态条目 | S2 |
| **S4** | persona 行：deployment 默认 + session 遮蔽 + epoch/digest | S1 |
| **S5**（缓议） | `seats.nacp()` + cloud 侧 client-owned 字段映射 | cloud-runtime 接入时 |
| **S6**（缓议） | memory/todo/compaction kinds 实装 | 对应功能立项时 |

**禁止项**：S2 前不得在 `acp.ts`/`runtime.ts` 里写死任何提示词文本（绕过 units 表即违规）；S5 前不得把本地 persona 字节混入 NACP 请求。

---

## 9. 待业主点收清单

1. **本地默认 persona 文案本体**：dsh 仓内 persona 为部署配置（默认空），本地发货文案需业主给稿或授权起草；
2. `instruction_profile` 在本地用 `deployment` 权威档（新增档）还是复用 `tenant` 档语义；
3. head 区变更触发 `restartCore` 的代价接受度（wx wasm 重启延迟实测）vs 会话级组件降级进 prompt 块的备选；
4. `memory` 在 v1 是否保留空壳座位还是整 kind 推迟；
5. 分包命名 `subpkg/context` vs `subpkg/system-instructions`；
6. tail 区组件在 prompt 块内的包裹形制（裸文本 vs 自有约定标签——dsh 的 `runtime-context` 快照措辞 vs nano 的 frame unit 风格）；
7. `mode_policy` 的 kind 名与模式闭合枚举的初始值（`default`/`plan` 是否够 v1）；
8. 条件工具准入的实现取舍：模式切换触发 restartCore（语义保真、付一次重启）vs `tool_call` 侧 host 拒绝（省重启、模型可见不可调）。

## 10. 诚实边界汇总（不得越界宣称）

- **fx 只有一条 instructions 串**：nano 的多条 system 消息在本地 head 区折叠成一串，消息边界丢失，仅保字节序。
- **fx 会话内前缀冻结**：无 `in-history` 更新等价物——head 区变更只在下次激活生效；会话内变化只能降级为 prompt 块搭车。
- **`libfx.tools` 是 initialize 时声明的**：dsh 的 `when:` 条件工具在 fx 接缝下无法逐 prompt 增减——工具准入差集变化须随 head digest 走 restartCore，或在 `libfx/tool_call` 应答侧做 host 拒绝（模型看得见但调不通，语义弱于 dsh 的不可见）。选哪条属 §9 点收项。
- **角色降级**：session/turn 区组件在 nano 是 system-role 消息，在本地经 prompt 块是 user-role——已登记的结构偏离，不掩饰。
- **`libfx/new` 不建 durable wasm_state**（`sessions.zig:118-177`）：fx 侧会话持久化与 `session/new`(wasm) 的取舍属另一档，本拓扑不裁决。
- **instructions ≤64KiB 硬上限**：units + persona + catalog 总量受限；skill_catalog 超限时只能裁剪，不能溢出。
- **本地无 cordis scope 树**：dsh 的 per-agent scoped 遮蔽降级为 session 粒度；subagent 级 persona 无对应物（本地无 subagent 前无此需求）。
- **nano 编译期闸门不复制**：units 表纪律靠评审与登记维持，无 literal-zero 机器检查。
- **cloud 侧 canonical 不可本地复制**：本地 canonical 是本地起草文本，与云端 canonical **内容不同步、也不应声称同步**——共享的只是 kind 与座位。
- **`complete`/`includeRuntimeContext` 仅本地语义**：cloud 侧 profile 行为由 NACP 合同决定，本地不代管。
