# test/simulation — Simulation 测试登记

> 唯一登记真源：本文件。旧 `test/README-draft.md` 只保留历史作废说明。
> 本目录不参与小程序打包、构建、上传或发布；独立删除 `test/simulation/` 不影响发布。
> 当前状态：v1 已登记，测试实现待建。

## 1. 业主原则与心智模型

| # | 原则 | 心智模型（是什么 / 不是什么） | 对设计的硬约束 | 禁止的反模式 |
|---|------|------------------------------|----------------|--------------|
| P-01 | Simulation 是基于微信开发者工具的真实 E2E | 是一条用户能走完的业务旅程，不是接口分层测试的集合 | 每条 sim 从真实 App 页面进入，经真实 wx API、VFS、kernel/fx、HTTP/WS 到真实数据面 | 纯 Node 合同测试、纯 unit 测试、脱离 DevTools 的 mock 单测 |
| P-02 | 必须是真实业务、真实拓扑、真实接口 | 拓扑是 App → 网关 → 对象存储/云函数；接口形状必须是真的 | mock 只替换外部提供方；App 内部、VFS、durable 客户端、传输层不 mock | mock App 内部服务、绕过真实 HTTP 直接调函数、用假拓扑代替 FRD1/测试网关 |
| P-03 | 起点是 mock 数据，终点是 live | 同一条业务旅程要能在受控数据下走通，也能在真实数据面走通 | 每条 sim 必须同时有 `mock-pass` 与 `live-pass`；报告分列，不合并 | 只跑 mock 就报全绿、把 live 缺失写成 PASS、用 mock 结果冒充真实接口 |
| P-04 | 验证过程有数据验证、截图验证 | 结果不是 exit code，而是“数据对 + 用户看得到” | 每个检查点读 App 状态与远端数据；至少起点/动作后/终态三张截图 | 只看 exit 0、只数 PASS、无截图、截图不绑定断言 |
| P-05 | 与 spike 一样，不能反向成为 release gate | simulation 是证据工具，不是发布审批器 | 不注册 npm script、不接 CI、不被 `app.json`/构建引用；删掉本目录仍可发布 | 设“sim 全绿才能发版”、把 sim 接入上传/发布流水线、要求业主签发 |
| P-06 | 命名规范 `sim-{slug}`；语言不限 | 目录名就是测试名；实现语言服从测试要求 | 每条一个 `sim-{slug}` 目录；可用 mjs/py/ts/sh | `mn01`/`ep1`/`wave1` 等阶段名、按层分 `unit/contract/e2e` 目录 |
| P-07 | 合同与 E2E 全部在 simulation 内完成 | 合同断言是业务旅程中的检查点，不是独立层 | CAS 412、票据隔离、VFS 上限、claim 冲突等嵌入对应 sim | 另建 contract/unit 套件、把合同测试从业务旅程中抽离 |
| P-08 | 不得过度仪式 | 只保留业务价值高的线路；登记即测，不测不登记 | 不设优先级或其他分类；不做静态文档对账 | 阶段验收矩阵、docs-check、soak 闸、无业务价值的 golden A/B |

## 2. Simulation 条目登记

当前登记 8 条，全部按下表执行；不设优先级或其他分类。每条都按 `mock-pass → live-pass` 双形态设计。

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

## 5. Simulation 文件夹拓扑

```text
test/simulation/                         # 仿真测试根；不打包、不接 CI
├── README.md                            # 本文件：唯一登记真源（原则/条目/正反价值/拓扑/版本）
├── lib/                                 # 共享仿真底座（待建；只放跨 sim 能力）
│   ├── devtools.mjs                     # DevTools/automator 连接、AUTO_PORT、页面 route
│   ├── mock-upstream.mjs                # 外部边界 mock：LLM/cloud/SOTER/clock
│   ├── fixtures.mjs                     # 合成 oid、文件、消息、错误样本
│   ├── evidence.mjs                     # result.json 信封与 .anote 证据路径
│   ├── assertions.mjs                   # page data/storage/VFS/远端读回断言
│   └── screenshots.mjs                  # 截图、route/元素断言、稳定页基线 diff
├── sim-boot-session/
│   ├── README.md                        # 该条业务旅程、mock/live 前置、证据口径
│   ├── run.mjs                          # 入口：--mode both|mock|live
│   └── fixtures/                        # 该条专用 mock 数据 / scripted LLM
├── sim-agentic-chat/{README.md,run.mjs,fixtures/}
├── sim-vfs-roundtrip/{README.md,run.mjs,fixtures/}
├── sim-vfs-offline/{README.md,run.mjs,fixtures/}
├── sim-claim-conflict/{README.md,run.mjs,fixtures/}
├── sim-alarm-resume/{README.md,run.mjs,fixtures/}
├── sim-engine-routing/{README.md,run.mjs,fixtures/}
└── sim-production-surface/{README.md,run.mjs,fixtures/}
```

| 层级 | 用途 | 约束 |
|------|------|------|
| `test/simulation/` | 仿真测试根 | 不被 `app.json`、`package.json`、构建脚本引用 |
| `README.md` | 登记真源：原则、条目、正反价值、拓扑、版本 | 冲突时以本文件为准 |
| `lib/` | 跨 sim 的 DevTools/mock/截图/断言能力 | 不 import 小程序源码内部；只经公开页面/接口 |
| `sim-{slug}/` | 一条完整业务旅程 | 目录名即测试名；禁止阶段名或分层名 |
| `run.mjs`（或 py/ts/sh） | 该条入口；`--mode {both,mock,live}` | 默认 both；live 缺失报 `live-blocked` |
| `fixtures/` | 该条 mock 数据、scripted LLM/tool | 固定可复现；不写真实 oid |
| `README.md`（条目内） | 业务旅程、前置、断言、截图点 | 与根 README 不重复维护规则 |
| `.anote/simulation/sim-{slug}/{mode}/{UTC}/` | 运行证据（repo 外） | `result.json` + `shots/*.png` + 数据快照；不入仓 |

## 6. 延伸阅读

- `scripts/dev-cli/README.md`：DevTools 五通道、automator、ProbeDriver、真机 dump。
- `cloud/durable/README.md`：durable 合同、生产/测试双入口、fss3 退役记录。
- `cloud/test-s3/README.md`：FRD1 测试网关、测试桶、生产切流历史。
- `docs/truth/mini-nano/MN06-ep2-handoff.md`：§1 原语语义合同、§5 已知限制。
- `docs/closure/mini-nano/1st-wave/MN06-closure.md`：§8 EP-2 前 blocker 唯一真源。
- `test/spike/README.md`：spike 的证据纪律；simulation 与其同属“非发布闸”。
- `AGENTS.md`：项目原则（单向访问、命名中立、单一真源、不得过度仪式、不得擅自扩约）。
- 微信小程序开发文档：`https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/`

## 7. 日期与版本

| 项 | 值 |
|----|----|
| 版本 | `v1` |
| 日期 | 2026-11-07 |
| 状态 | 已登记，待建 |
| 范围 | 8 条；全部 `sim-{slug}` |
| 变更 | v1 初版：原则表、条目表、正/反价值、拓扑、延伸阅读 |
