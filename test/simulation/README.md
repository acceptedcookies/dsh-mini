# test/simulation — Simulation 测试登记

> 唯一登记真源：本文件。旧 `test/README-draft.md` 只保留历史作废说明。
> 本目录不参与小程序打包、构建、上传或发布；独立删除 `test/simulation/` 不影响发布。
> 当前状态：v4。mock 已跑。`live-pass` 只认手机也会走的公网 `https://`。`127.0.0.1` SSH 隧道只证明网关进程，不是发布后的用户路径，结果记 `not-phone-path`，不作 live-pass。

## 1. 业主原则与心智模型

| # | 原则 | 心智模型（是什么 / 不是什么） | 对设计的硬约束 | 禁止的反模式 |
|---|------|------------------------------|----------------|--------------|
| P-01 | Simulation 是基于微信开发者工具的真实 E2E | 是一条用户能走完的业务旅程，不是接口分层测试的集合 | 每条 sim 从真实 App 页面进入，经真实 wx API、VFS、kernel/fx、HTTP/WS 到真实数据面 | 纯 Node 合同测试、纯 unit 测试、脱离 DevTools 的 mock 单测 |
| P-02 | 必须是真实业务、真实拓扑、真实接口 | 拓扑是 App → 网关 → 对象存储/云函数；接口形状必须是真的 | mock 只替换外部提供方；App 内部、VFS、durable 客户端、传输层不 mock | mock App 内部服务、绕过真实 HTTP 直接调函数、用假拓扑代替 FRD1/测试网关 |
| P-03 | 起点是 mock 数据，终点是 live | 同一条业务旅程要能在受控数据下走通，也能在真实数据面走通 | 每条 sim 必须同时有 `mock-pass` 与 `live-pass`；报告分列，不合并 | 只跑 mock 就报全绿、把 live 缺失写成 PASS、用 mock 结果冒充真实接口 |
| P-04 | 验证过程有数据验证、截图验证 | 结果不是 exit code，而是“数据对 + 用户看得到” | 每个检查点读 App 状态与远端数据；至少起点/动作后/终态三张截图，全部落当前 sim 的 `evidence/` | 只看 exit 0、只数 PASS、无截图、截图不绑定断言 |
| P-05 | 与 spike 一样，不能反向成为 release gate | simulation 是证据工具，不是发布审批器 | 不注册 npm script、不接 CI、不被 `app.json`/构建引用；删掉本目录仍可发布 | 设“sim 全绿才能发版”、把 sim 接入上传/发布流水线、要求业主签发 |
| P-06 | 命名规范 `sim-{slug}`；语言不限 | 目录名就是测试名；实现语言服从测试要求 | 每条一个 `sim-{slug}` 目录；可用 mjs/py/ts/sh | `mn01`/`ep1`/`wave1` 等阶段名、按层分 `unit/contract/e2e` 目录 |
| P-07 | 合同与 E2E 全部在 simulation 内完成 | 合同断言是业务旅程中的检查点，不是独立层 | CAS 412、票据隔离、VFS 上限、claim 冲突等嵌入对应 sim | 另建 contract/unit 套件、把合同测试从业务旅程中抽离 |
| P-08 | 不得过度仪式 | 只保留业务价值高的线路；登记即测，不测不登记 | 不设优先级或其他分类；不做静态文档对账 | 阶段验收矩阵、docs-check、soak 闸、无业务价值的 golden A/B |
| P-09 | 所有 sim evidence 必须独立存储在当前的 sim 文件夹内，并被 gitignore | 证据是本机运行产物，不是仓库内容；每条 sim 自带证据目录 | 固定 `test/simulation/sim-{slug}/evidence/{mode}/{UTC}/`；`result.json`、截图、artifacts 全在此；根 `.gitignore` 忽略所有 evidence/artifacts/shots | 写 `.anote/` 或仓库根、跨 sim 共用证据目录、提交截图/artifact、把 evidence 放进 `fixtures/` |

## 2. Simulation 条目登记

当前登记 8 条，全部按下表执行；不设优先级或其他分类。每条都按 `mock-pass → live-pass` 双形态设计；运行 evidence 只落该条 `evidence/`，并由 `test/simulation/.gitignore` 忽略。

| # | 条目 | 业务旅程 | 负责的测试价值 | 具体表达（接口/状态/UI/数据） | mock-pass 起点 | live-pass 终点 |
|---|------|----------|----------------|-------------------------------|----------------|----------------|
| 1 | `sim-boot-session` | 冷启动 → 主题/壳 → unlock → durable session → prompt → turn → 杀进程/重载 → 续跑 | 证明 App 从零到可对话、再到崩溃恢复的完整生命周期 | `/healthz`、`/dev/ticket`、`/v1/state/*`、session store、checkpoint、transcript；UI：启动/会话/续跑 | `cloud/sim` + scripted LLM + 合成 oid | FRD1 测试网关 + 真 durable + 真票（SOTER 标注 `control_mock`） |
| 2 | `sim-agentic-chat` | 输入 prompt → 流式 → tool call → cancel → 上游错误/重试 | 证明 agentic 对话主链在正常、取消、错误三种用户路径下都成立 | LLM 流式、tool 结果、transcript、error center 分类；UI：正常/取消/错误三态 | scripted LLM/tool/error | 真 magpie + 测试网关 |
| 3 | `sim-vfs-roundtrip` | 写文件 → 列表 → 读 → range → 删 → artifact publish → 公网 `/a/` 回读 | 证明 VFS 与 artifact 的读写闭环、字节一致性和边界限制 | `vfs/{put,get,del,list}`、`artifacts/publish`、`/a/{sha}`、8MB/256KB/list 上限；UI：文件列表/预览 | 本地测试网关 + 测试桶 | FRD1 9095 + `dsh-mini-test` MinIO |
| 4 | `sim-vfs-offline` | 断票/离线写删 → 恢复 → reconcile → 删除不复活 | 证明离线期间不丢写、不复活删除，恢复后能收敛到远端真源 | 本地行/墓碑、pending summary、远端 row/object、LWW；UI：离线提示/收敛后状态 | 强制离线 + 测试网关回放 | 真测试网关 + MinIO |
| 5 | `sim-claim-conflict` | shadow 持 claim → App prompt → 「会话写者冲突」→ 释放 → 重试 | 证明多写者不会静默分叉，冲突会被用户看见并恢复 | `/v1/claim`、holder、state CAS、冲突 toast/diag；UI：冲突/恢复 | shadow Node 客户端 + 测试网关 | 真测试网关 claim |
| 6 | `sim-alarm-resume` | 建 due alarm → sweeper tick → resume → tool 恰一次 | 证明 30s 闹钟能恢复挂起 turn，且不会重复执行 tool | `/v1/alarm/{due,claim}`、sweeper、resume 状态、tool 计数；UI：恢复中/完成 | 本地 sweeper + 受控时钟 | 云函数 sweeper + 真 30s + 测试网关 |
| 7 | `sim-engine-routing` | 设置页 provider/model/engine（local/cloud/magpie）→ bio 门禁 → enroll → 真轮 | 证明引擎、模型、凭证三者的路由与白名单在真实设置流程中成立 | 设置页、enroll/bio、引擎戳记、模型白名单、会话车道；UI：设置/注入/真轮 | `cloud/sim` + mock bio/challenge | 真测试网关 + 真 magpie；真 SOTER 仅真机，否则 `device-deferred` |
| 8 | `sim-production-surface` | 生产只读：healthz、无票 401、真实 oid `state/get` + `vfs/list`、`/dev/*` 404 | 证明生产入口对外只暴露合同面，鉴权与 oid 隔离有效，测试入口不外泄 | `https://dsh-mini.saobao.com` 只读、401/404、跨 oid 隔离；UI：App 生产配置只读页 | 本地测试网关 + 合成 oid | `https://dsh-mini.saobao.com` 只读 |

## 3. 当前 sim 合集代表的正面价值 / 接口

| 价值面 | 具体接口 / 机制 | 覆盖条目 |
|--------|------------------|----------|
| App 生命周期 | 冷启动、主题、unlock、session store、重载续跑 | `sim-boot-session` |
| 对话主链 | 流式、tool call、cancel、error center、transcript | `sim-agentic-chat` |
| durable 状态 | `state/{get,put-cas}`、checkpoint、CAS 条件写 | `sim-boot-session`、`sim-claim-conflict` |
| VFS | 五根、`vfs/{put,get,del,list}`、range、本地行/墓碑 | `sim-vfs-roundtrip`、`sim-vfs-offline` |
| Artifact | `artifacts/publish`、`/a/{sha}`、内容寻址 | `sim-vfs-roundtrip` |
| 多写者协调 | `claim`、holder、冲突 UI、释放重试 | `sim-claim-conflict` |
| 闹钟恢复 | `alarm/{due,claim}`、sweeper、resume、恰一次 | `sim-alarm-resume` |
| 鉴权与隔离 | ticket、无票 401、oid 注入、跨 oid 隔离、生产 `/dev/*` 404 | `sim-production-surface`、`sim-engine-routing` |
| 引擎与模型 | local/cloud/magpie 路由、provider/model 白名单、bio/enroll | `sim-engine-routing` |

这些条目代表的是**用户可完成的业务闭环**，不是接口覆盖率数字。

## 4. 当前 sim 合集验证的负面 / 反向价值

| 反向价值 | 失败/攻击面 | 覆盖条目 | 必须看到的断言 |
|----------|-------------|----------|----------------|
| 未授权访问 | 无票、坏票、过期票、跨 oid 读写 | `sim-production-surface`、`sim-engine-routing` | 401/404/403 按合同返回；不泄漏另一 oid 数据 |
| 测试入口外泄 | 生产环境出现 `/dev/*`、admin 面 | `sim-production-surface` | 生产 `/dev/*` 为 404，无 admin 响应 |
| 路径穿越 / 键注入 | `../`、`//`、前导 `/`、伪造 `dsh-mini` 段 | `sim-vfs-roundtrip` | 400/拒绝；不写出 oid 前缀 |
| CAS 竞态 / 丢更新 | 并发写、旧 etag、claim 抢占 | `sim-boot-session`、`sim-claim-conflict` | 412 恰一成功；不静默覆盖 |
| 恢复重复执行 | 杀进程、alarm 重放、resume 重入 | `sim-boot-session`、`sim-alarm-resume` | tool 恰一次；transcript 不重复 |
| 删除复活 | 离线删、墓碑过期、远端旧行回拉 | `sim-vfs-offline` | 删除后不复活；远端新于碑时按 LWW 重建 |
| 离线丢写 | 无票写、断网、恢复中断 | `sim-vfs-offline` | pending 保留并可重试；恢复后收敛，不静默丢 |
| 容量边界绕过 | 256KB state、8MB 对象、list 1000、行面预算 | `sim-vfs-roundtrip` | 超限按合同拒绝；分页/range 正确 |
| 模型/供应商越权 | 非白名单 model、跨车道 provider | `sim-engine-routing` | 服务端拒；UI 不展示不可用选项 |
| 错误静默/误分类 | 上游 5xx、rate-limit、abort、tool 失败 | `sim-agentic-chat` | 用户可见或进 error center；不误报成功 |
| mock 冒充 live | 只跑 mock、control-plane mock 未标注 | 所有条目 | 报告分列 `mock-pass`/`live-pass`/`control_mock`；缺 live 为 `live-blocked` |
| 发布耦合 | simulation 被构建/CI 引用 | 目录拓扑本身 | 删除 `test/simulation/` 后 typecheck/编译/上传/发布不受影响 |

## 5. Simulation 回顾与加强方法

> 这一节是**回顾方法**，不是新的测试层、不是 release gate、不是评分表。用于定期检查任意一条 sim 是否仍在其核心叙事内、证据是否支撑声称、mock/live 是否成立。输出是一份很短的“缺口 + 最小下一步”，记录在该 sim 的 README（必要时更新根 README 的登记行），不另立文件。

### 5.1 四个镜头

| 镜头 | 必答问题 | 看什么证据 | 合格标准 | 常见反模式 |
|------|----------|------------|----------|------------|
| **深度（Depth）** | 这条 sim 声称的价值，最后一步是什么？测试是否真的走到最后一步？ | sim README 的 journey；run.mjs 的 checks；result.json 的 checks/shots；状态/计数断言 | 声称的每一步都有对应 check；关键失败至少有一个负例；终态有数据断言，不只看 exit 0 | 只测 transport 就宣称 journey；用截图/输入可见代替状态断言；happy path 全绿 |
| **宽度（Width）** | 这个能力的核心爆炸面有哪些？哪些在 scope 内但没测？ | 根 README 的正反价值表；接口/状态机/拓扑；代码锚；现有 checks 的覆盖 | scope 内的核心面有覆盖；没覆盖的显式登记为空白/`live-blocked`/`deferred` | 只测一个 endpoint；把全量错误枚举塞进来；把别的 sim 的面重复测 |
| **Scope** | 每个 check 对应哪条业务价值？有没有测试别的 sim 的东西？ | 根 README 条目；sim README；check 名称与断言 | 每个 check 能映射到本 sim 的核心叙事；越界项移走/删除；欠界项补链或降级登记 | 用 App prompt 冒充 alarm；重复 sim-boot-session；把 UI smoke 当业务闭环 |
| **Mock/Live** | mock 替换了什么外部提供方？live 出口是否真实可达？ | lib/gateway、mock-upstream、result.json 的 control_mock/status/endpoint | mock 只替外部提供方；live 有真实可达出口或显式 `live-blocked`；mock 数据/工具足够复现 | mock App 内部/传输层；live 终点拓扑不可达；只跑 mock 报全绿；control_mock 列了没用的东西 |

### 5.2 回顾步骤

1. **提取声称**：读根 README 的登记行 + 该 sim 的 README，用一句话写出“它声称证明什么”。
2. **对齐证据**：把 `result.json` 的每个 check 映射到声称的步骤，标成 `proven` / `claimed-not-proven` / `proven-not-claimed`。
3. **四维扫描**：按 §5.1 的四个镜头列缺口；缺口只写“缺什么面/缺什么负例/越界/拓扑不成立”，不写长报告。
4. **选最小加强**：只选能闭合核心叙事的最小一组；优先 consumer/execution 链，其次关键负例；不建新框架、不建新目录、不建 release gate。
5. **登记与复跑**：更新该 sim 的 README（必要时根 README 的登记行），重跑 mock/live；`live-blocked`/`ui-deferred` 如实保留；evidence 仍落该 sim 的 `evidence/`。

### 5.3 判定规则

- **声称的最后一步没有被 check 覆盖** → 要么补链，要么把 sim 降级为 contract smoke 并改根 README 的登记行；不能两者都不做。
- **一个 check 不能映射到本 sim 的价值** → 移到对应 sim 或删除；不要用“多测一点”当理由。
- **mock 替换了 App 内部/传输层** → 违反 P-02，必须改成只替外部提供方。
- **live 出口拓扑不可达** → 改登记（换 live 定义/标 `live-blocked`），不要用 mock 冒充 live-pass。
- **live 需要生产写入** → opt-in，不放进默认 `both`；必须有清理步骤和残留登记。
- **负例** → 只加 contract 边缘和本 sim 的核心失败面；不加全量错误枚举。
- **回顾输出** → 3–5 条缺口 + 1 个最小下一步；不评分、不排优先级分类、不另立文件。

### 5.4 什么时候回顾

- 一条 sim 第一次 `mock-pass` 之后；
- 准备声称 `live-pass` 之前；
- 生产事件/closure blocker 变化后；
- 新增公共合同面或新 lane 后；
- 阶段收口时做一次批量回顾（不是固定日历，不设 CI）。

> 方法本身不产生新测试；它只决定“下一条最小加强是什么”。任何新增测试仍按 §2 登记、按 P-05/P-08 保持非 release gate、非仪式。

## 6. Simulation 文件夹拓扑

```text
test/simulation/                         # 仿真测试根；不打包、不接 CI
├── README.md                            # 本文件：唯一登记真源（原则/条目/正反价值/拓扑/版本）
├── .gitignore                           # 忽略所有 sim 的 evidence/artifacts/shots
├── lib/                                 # 共享仿真底座（待建；只放跨 sim 能力）
│   ├── devtools.mjs                     # DevTools/automator 连接、AUTO_PORT、页面 route
│   ├── mock-upstream.mjs                # 外部边界 mock：LLM/cloud/SOTER/clock
│   ├── fixtures.mjs                     # 合成 oid、文件、消息、错误样本
│   ├── evidence.mjs                     # result.json 信封与当前 sim 的 evidence 路径
│   ├── assertions.mjs                   # page data/storage/VFS/远端读回断言
│   └── screenshots.mjs                  # 截图、route/元素断言、稳定页基线 diff
├── sim-boot-session/
│   ├── README.md                        # 该条业务旅程、mock/live 前置、证据口径
│   ├── run.mjs                          # 入口：--mode both|mock|live
│   ├── fixtures/                        # 该条专用 mock 数据 / scripted LLM
│   └── evidence/                        # gitignored：result.json + shots + artifacts
├── sim-agentic-chat/{README.md,run.mjs,fixtures/,evidence/}
├── sim-vfs-roundtrip/{README.md,run.mjs,fixtures/,evidence/}
├── sim-vfs-offline/{README.md,run.mjs,fixtures/,evidence/}
├── sim-claim-conflict/{README.md,run.mjs,fixtures/,evidence/}
├── sim-alarm-resume/{README.md,run.mjs,fixtures/,evidence/}
├── sim-engine-routing/{README.md,run.mjs,fixtures/,evidence/}
└── sim-production-surface/{README.md,run.mjs,fixtures/,evidence/}
```

| 层级 | 用途 | 约束 |
|------|------|------|
| `test/simulation/` | 仿真测试根 | 不被 `app.json`、`package.json`、构建脚本引用 |
| `README.md` | 登记真源：原则、条目、正反价值、拓扑、版本 | 冲突时以本文件为准 |
| `.gitignore` | 忽略所有 sim 运行产物 | `**/evidence/`、`**/artifacts/`、`**/shots/`、`**/screenshots/` 永不入库 |
| `lib/` | 跨 sim 的 DevTools/mock/截图/断言能力 | 不 import 小程序源码内部；只经公开页面/接口 |
| `sim-{slug}/` | 一条完整业务旅程 | 目录名即测试名；禁止阶段名或分层名 |
| `run.mjs`（或 py/ts/sh） | 该条入口；`--mode {both,mock,live}` | 默认 both；live 缺失报 `live-blocked` |
| `fixtures/` | 该条 mock 数据、scripted LLM/tool | 固定可复现；不写真实 oid；不是运行产物 |
| `evidence/`（条目内） | 该条运行证据：`{mode}/{UTC}/result.json`、`shots/*.png`、artifacts | 必须在本 sim 文件夹内；全部 gitignore；不跨 sim 共用 |
| `README.md`（条目内） | 业务旅程、前置、断言、截图点 | 与根 README 不重复维护规则 |

## 7. 延伸阅读

- `scripts/dev-cli/README.md`：DevTools 五通道、automator、ProbeDriver、真机 dump。
- `cloud/durable/README.md`：durable 合同、生产/测试双入口、fss3 退役记录。
- `cloud/test-s3/README.md`：FRD1 测试网关、测试桶、生产切流历史。
- `docs/truth/mini-nano/MN06-ep2-handoff.md`：§1 原语语义合同、§5 已知限制。
- `docs/closure/mini-nano/1st-wave/MN06-closure.md`：§8 EP-2 前 blocker 唯一真源。
- `test/spike/README.md`：spike 的证据纪律；simulation 与其同属“非发布闸”。
- `AGENTS.md`：项目原则（单向访问、命名中立、单一真源、不得过度仪式、不得擅自扩约）。
- 微信小程序开发文档：`https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/`

## 8. 日期与版本

| 项 | 值 |
|----|----|
| 版本 | `v4` |
| 日期 | 2026-11-07 |
| 状态 | 8 条已实现；§5 回顾方法已登记 |
| 范围 | 8 条；全部 `sim-{slug}` |
| 变更 | v2 登记 P-09；v3 落地 lib 与 8 条 run.mjs。mock-pass 已取证；写面 live 在测试网关停用期间为 live-blocked；v4 新增 §5 回顾与加强方法（四维：深度/宽度/Scope/Mock-Live） |
