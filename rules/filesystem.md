# filesystem —— dsh-mini local-runtime 五根 VFS

> 状态：**已落地并实测 PASS**（VFS-1/2/3 切片完成；VFS-4 fx-term、VFS-5 cloud-pinned 未动工）。实测见 §12。
> 文档日期 2026-11-04。事实基线：nano-agent `neo`@`f72875054` filesystem-core 现役合同（`agent-execution-read-face.json` v1 + `workspace-path-contract.ts` BCEY4 冻结面）；`services/fx` 第一批已实测 PASS（devtools-sim）；cloud-sim BYOK 管道已实测 PASS。
> 同族文档：`rules/topology-local.md`（秘钥托管）。证据等级沿用 test/spike 规范。
> 立场声明（AGENTS §0）：五根语义、只读闸、UNAVAILABLE 清单一律照抄 nano-agent 冻结面，**不自创第六根、不改 lane 判定、不加本地特化语义**；凡本文与上游合同冲突处，以上游为准并登记待裁。

## 1. 目标与非目标

**目标**
- 在 local-runtime（fx wasm + 小程序宿主）内提供与 nano-agent filesystem-core **同构的五根 VFS**：同一组路径、同一裁决法则、同一错误语义。
- 让 `/data/{session_uuid}` 等路径在本地与远端 nano runtime **含义完全相同**——文件语义随运行时切换无缝，用户文件不随绑定改变而改义。
- 为 `fx-term.wasm`（wasm.terminal）预备宿主工作区面：terminal 的 `shell.run` 后端以本 VFS 为真源。
- 诚实陈述 durability：本地档**不承诺**「一个 durable 文件系统」，只承诺每行记录显式声明的 placement。

**非目标**
- 不做 restore/snapshot/CAS/deep-materialization（nano 同样 `UNAVAILABLE_BY_CONTRACT`）。
- 不把字节塞进 `wx.storage`（10MB KV 是元数据面，不是对象层）。
- 不在 wasm 线性内存里建文件系统（上游已退役此形态，见 §3.1）。
- 本地档不假装多写者并发——单进程 JS 串行化免费，但保留 journal 形态以备远端共存。

## 2. 困境分析：为什么不能 promise durable

小程序与 Cloudflare Workers 是**同一个困境的两个实例**——「执行环境没有可承诺的本地持久盘」。filesystem-core 存在的理由原文即此：**「在 Workers 没有本地持久盘的前提下，把 workspace 文件收成一个 leaf」**。

| 介质 | 小程序事实 | Workers 对照 | 结论 |
|---|---|---|---|
| `USER_DATA_PATH`（`wx.getFileSystemManager`） | 沙箱可写目录；OS 可回收、清数据/重装即丢、升级行为文档不承诺 | isolate 本地盘：请求间不保证存活 | **cache-tier，非 truth** |
| `wx.storage` | 10MB KV 上限；同步 API；用户清数据即丢 | D1：真 durable，但有额度 | 元数据真源可放这里（行小）；**durable 承诺弱于 D1** |
| wasm 线性内存 | 4MB 包 + 会话即焚 | isolate 内存：已退役热视图 | **永远不是文件层** |
| 云端对象（CloudBase storage / nano filebucket） | 需账号/管道，已建成 BYOK 通道 | R2：字节对象层 | **唯一强 durable 层** |

**推论**：任何「小程序本地文件系统」的设计若把 durable 当隐含属性，即与现实脱节。正确解法是 nano 的答法——**durable 按行声明（placement），不按文件系统承诺**。

## 3. nano-agent 参照模型（照抄面）

### 3.1 「热视图」语义校正

nano 现役 VFS ≠ 内存热视图。wasm 线性内存热视图已整链退役（`ATU1 P3`，`session_vfs_journal`/`session_vfs_meta` DROP）。心智模型登记：**「任何新设计若把『VFS』读成『wasm 线性内存里的热视图』，即与现役拓扑脱节」**（`mental-modal.md:213`）。

现役 VFS = **五根命名空间 + lane 裁决 + 列举投影 + 对象解引**；`ls` 权威在列举，不在内存。

### 3.2 五根 lane 法（BCEY4 冻结，`WORKSPACE_LANE_ROOTS` 闭集）

```
/ ── 恰五根
├─ /root/{p}          hub lane     → nano_user_files          可写（actor-self）
├─ /data/{s}/{p}      session lane → nano_session_temp_files  可写（session stamp）
├─ /tmp/{p}           scratch lane → 同上 store tmp/ 前缀     可写（scratch stamp）
├─ /mnt/{name}/{p}    mount lane   → mounts 投影              只读（read-through）
└─ /backup/{name}/{p} backup lane  → replicas 投影            只读（不可变副本）
```

- 唯一裁决器 `resolveWorkspacePathTarget`：**路径自身决定 lane**，无请求侧 scope 字段、无 env 开关、无别名兼容（`/workspace`、相对逃逸 `..` 一律 `unsafe-workspace-path`）。
- 只读闸：`WORKSPACE_READ_ONLY_PREFIXES = ["/mnt","/backup","/root/.profile","/artifacts"]`；`/data/{s}/artifacts/**` 同为只读保留面（`/artifacts` 是保留名，不是第六根）。
- cwd 法则：工作目录恒为 `/data/{session_uuid}`。

### 3.3 存储二分与 placement

D1 行 = durable 真源：`virtual_path` + `r2_object_key` + `content_hash` + `size_bytes` + **`placement_id`**。字节在对象层。**placement 是每行的显式属性**——同一棵树，不同行的字节可住不同介质、不同承诺级。

### 3.4 读视图（有界陈旧热视图，合同 v1）

`getWorkspaceReadView` → 枚举 immutable population → `root_digest`（canonical JSON SHA-256）→ `read_view_revision` + `manifest_uuid` → `readWorkspaceManifestPage`（页读）→ `readWorkspaceObjectRange`（对象 range 读）。
- 陈旧度由 **mutation fence**（journal：pending/finished/unknown）圈定；fence block 时写在字节落盘前返回 `not-started`。
- `P-VIEW` 预算闸：manifest_entries / manifest_bytes / page / range_max_bytes。
- `production_activation: "disabled-unqualified"`——nano 自己尚未生产激活此面；我们实现的是**同构形状**，不冒充其激活态。

### 3.5 显式 UNAVAILABLE（照抄）

`restoreWorkspace` / `snapshotWorkspace` / `casWorkspaceRevision` / `deep_materialization` / `workspace_wide_revision` / `file_snapshot`——读视图只承诺「看一眼一致的现在」，不承诺「回到过去」。

### 3.6 存活纪律：读取前记账

byte_len 预算、单文件顶、readOut 封顶、maximum、strike 降级——wasm 热视图死了，此纪律作为**任何 hot tier 的硬前置**活着。本地 VFS 的任何缓存/预取同样先记账后读。

## 4. 本地 ↔ 云端对照（逐 lane）

| lane | nano-agent（durable 真源） | dsh-mini local-runtime | durability 承诺差 |
|---|---|---|---|
| `/root` hub | nano_user_files → R2 | `wx.storage` 行 + USER_DATA_PATH 字节；登录/注入后可 pin 云端对象 | 本地=best-effort；pin 后=durable |
| `/data/{s}` session | nano_session_temp_files → R2 | 同上，session 作用域 | 本地=best-effort（会话界内可接受） |
| `/tmp` scratch | tmp/ 前缀 → R2 | USER_DATA_PATH tmp/ + storage 行 | 本就是 ephemeral，两端等价 |
| `/mnt` mount | 投影源=成员 hub 前缀 | **首版：空投影**（挂载表注册面在，名单为空） | 占位留缝，语义不丢 |
| `/backup` | replicas 不可变副本 | 同上：空投影 | 占位留缝 |
| 裁决器 | `resolveWorkspacePathTarget` | TS 同构移植（同一闭集、同一拒绝语义） | 无差 |
| 字节层 | R2 对象 | USER_DATA_PATH（本地 placement）/ 云端对象（pinned placement） | 按行声明 |
| fence | journal 多写者 | 单进程串行 + 同形 journal | 本地语义更弱但形状保留 |
| 读视图 | manifest + qualification 闸 | 同形 manifest；本地「qualification」为自签内省（形状保留，不声称 nano 级验收） | 诚实标注 |

**关键裁决**：`/mnt`、`/backup` 本地不做成「不支持」——做成**存在但为空列举的合法 lane**。这样 `/mnt/foo` 在本地与远端同样判为「lane 合法、只读、当前无挂载」，路径语义两端一致；将来云端挂载注入时本地自动兼容。

## 5. 本地五根视图（dsh-mini 形态）

```
/ ── 恰五根（与 nano 同一闭集）
├─ /root/{p}          hub    → storage 行 + USER_DATA_PATH/root/… 字节   可写
├─ /data/{s}/{p}      session→ storage 行 + USER_DATA_PATH/data/{s}/…    可写（cwd 法则同源）
├─ /tmp/{p}           scratch→ USER_DATA_PATH/tmp/… + storage 行         可写（ephemeral）
├─ /mnt/{name}/{p}    mount  → 挂载名注册表（首版为空）→ read-through    只读
└─ /backup/{name}/{p} backup → 副本注册表（首版为空）                    只读
```

**行形态**（storage 内 per-path JSON，即 D1 行 analog）：
```json
{ "virtual_path": "/data/s-1/notes.md",
  "object_key": "vfs/sha256/ab/abcd…",
  "content_hash": "sha256:…", "size_bytes": 1234,
  "placement": "local-scratch | local-hub | cloud-pinned",
  "lane": "session", "committed": true,
  "updated_ms": 1730000000000 }
```

- **字节对象层**：`USER_DATA_PATH` 下按 `vfs/{hash[:2]}/{hash}` content-addressed 存放——hash 即 key，`content_hash` 校验即完整性，天然幂等去重。USER_DATA_PATH 被清 → 行存字节失 = placement 为 local 的诚实劣化面（见 §8）。
- **写路径**：先写对象（`.tmp-{token}` → rename 到 hash key），再落 storage 行 `committed:true`——对象先于行的序与 nano「写对象键与可见键分离」同形；中途崩溃留下的是无行引用的孤儿对象（可清扫），不是半真行。
- **删除**：行删即不可见；对象按无引用清扫，不做即时物理删（同 nano 的对象层惰性）。

## 6. 接缝（两个 wasm 面，同一 VFS）

```
fx-core.wasm（agent 核，现役）
   └─ 文件类工具 → fx_host_tool_call ─► services/vfs/（TS 层）
                                          ├─ resolvePathTarget（裁决）
                                          ├─ storage 行读写（元数据真源）
                                          └─ USER_DATA_PATH 字节读写 / 云端对象

fx-term.wasm（terminal，预留面）
   └─ shell.run {action:"run",command} ─► js_host_workspace seam
                                          └─ 宿主 shell 解释器（TS）
                                               └─ 同一个 services/vfs/
```

- **fx-core**：nano 同构——文件工具是 host tool（与 `get_weather` 同接缝），wasm 无 fs。工具集合：`file_read` / `file_write` / `file_list` / `file_stat`（名待业主定，语义映射 lane 操作）。
- **fx-term**：上游合同 v1 = `shell.run` completion-only、64KB 命令顶、30s deadline、ephemeral workspace、`root==cwd`。宿主侧解释 `ls/cat/pwd/cd/…` 对 VFS 执行——terminal 的 `ls` 权威在列举投影，与 nano 同一裁决。
- **WASI 文件 import 维持 `unavailable`**：fd_readdir/path_open/fd_prestat_dir_name 不开放——与「VFS 不在 wasm 线性内存」同构，也让 fx-core/fx-term 共享同一宿主文件面。
- **workspace contract 扩展点**：上游 v1 要 `ephemeral:true, root==cwd`；我们的 cwd 恒 `root=/data/{session_uuid}` 满足之；多 lane 可见性由 shell 解释器的路径裁决承担（`cd /root` 合法、`ls /` 恒列五根）。

## 7. 读视图（本地同构实现）

```
captureWorkspace(session)          ┐
  → enumerate population（五根行）  │
  → canonicalJson → sha256        │ services/vfs/read-view/
  → manifest {uuid,revision,       │  ├─ capture.ts   枚举+预算闸
      root_digest,entry_count}     │  ├─ manifest.ts  行存 storage
  → manifest 行存 storage          │  ├─ pages.ts     cursor 页读
readManifestPage(uuid,cursor,lim)  │  └─ range.ts     对象 range 读
readObjectRange(uuid,ver,path,     ┘
    offset,max_bytes)
```

- manifest 行带 TTL + population 上限（P-VIEW 同族预算：`manifest_entries`/`manifest_bytes`/`page_limit`/`range_max_bytes`，常量表照 nano `execution-bounds.json` 缩编）。
- mutation journal：单进程内 pending/finished/unknown 形态保留——turn 内写与读视图捕获同锁串行；将来 cloud-pinned 行被远端改时，此形态是过期检测的现成挂点。
- **不实现** qualification 的远端签发面（本地自签内省即可）；envelope/字段形状保留，若未来与 nano 读视图对账，形状无需迁移。
- 消费面：terminal `ls` 大目录时分页；agent 工具 `file_list` 同上；workspace-verify 型核验（若日后需要）形状已备。

## 8. 诚实边界与劣化面

1. **durability 分级是显式属性**：`local-scratch`（随时可丢）< `local-hub`（卸载/清数据才丢）< `cloud-pinned`（唯一 durable）。任何 UI/文档不得把本地 VFS 说成「持久文件系统」。
2. **USER_DATA_PATH 被清 = 行存字节失**：读时 `content_hash` 校验失败 → 对 scratch 报「已失效」并清行；对 local-hub 标 `bytes_missing` 退化态。**不静默返回错字节**。
3. **wx.storage 10MB 顶**：行预算（每行 ~300B → 万行级可行）；超限返回 `overflow`，不截断写入。
4. **模拟器 ≠ 真机**：USER_DATA_PATH 行为、storage 上限在真机（尤其 iOS）未实测——R 车道同 BYOK 一样挂未证标。
5. **读视图非激活面**：nano 上游 `disabled-unqualified`；本实现是「同构形状先行」，不声称达到 nano 的验收语义。

## 9. 与 cloud-runtime 的无缝兼容（设计的存在理由）

同一路径三种宿主，语义不随绑定漂移：

```
未登录 (local/cloud-sim)      nano 登录 (远端 runtime)
/data/{s}/notes.md ──┬── 本地 VFS 行 + USER_DATA_PATH 字节
                     └── nano_session_temp_files + R2 字节
                          ↑ 同一 virtual_path、同一 lane、同一 cwd 法则
```

- **切换运行时 = 切换后端，不是切换语义**：`bindRuntime` 已按登录态切换；文件语义不变。`file_list("/")` 两端恒列五根。
- **云端 pin 是桥**：`/root`、`/data` 行 placement 可升级 `cloud-pinned`——字节上行到云端对象后，远端 nano runtime 读到的与本地同内容（content_hash 为证）。这是「本地起草 → 云端接管」的物理通道。
- **/mnt 预留**：将来 nano 的 mount 治理面落地，本地 lane 已存在，注入即投影——无需改路径法。

## 10. 待业主点收（施工前）

1. **五根照抄确认**：本地 VFS 与 nano 共用同一闭集与只读闸（无本地特化 lane）。
2. **placement 三档**：`local-scratch`/`local-hub`/`cloud-pinned` 命名与升级策略（/root、/data 可 pin；/tmp 恒不可 pin）。
3. **工具面命名**：fx-core 文件工具名集（`file_*` 或其他），及其与 nano bash 工具面的对齐程度。
4. **fx-term 排期**：wasm terminal 是本期接还是仅按本文预留 seam。
5. **云端字节后端**：cloud-pinned 落到 CloudBase storage 还是 nano-platform filebucket（与 topology-local §12 同一决策簇）。
6. **读视图本地预算表**：P-VIEW 常量的本地取值（可先照 nano 缩编值起步）。

## 11. 施工切片（点收后建议序）

| 切 | 内容 | 验证 |
|---|---|---|
| VFS-1 | `services/vfs/`：裁决器 + storage 行 + USER_DATA_PATH 对象层 + 五根列举 | S1 单元驱动：写/读/列/拒绝语义 |
| VFS-2 | fx-core 文件工具缝（fx_host_tool_call → VFS）| agentic 测试加文件 turn（DevTools） |
| VFS-3 | 本地 read-view（capture/manifest/pages/range + journal） | 同一驱动内断言 manifest 一致性 |
| VFS-4 | fx-term.wasm 构建 + shell.run 宿主解释器 | terminal 内 `ls /` 恒列五根（DevTools） |
| VFS-5 | cloud-pinned 通道（复用 BYOK 票据管道上行对象） | sim-local-live 往返 + content_hash 校验 |

## 12. 实施状态与实测证据（2026-11-04 回填）

**已落地模块**（`services/vfs/`：`paths` 裁决器 / `store` 行面 / `objects` 对象层 / `journal` / `vfs` 门面 / `read-view` / `api` barrel；fx 侧 `file_read/write/list/stat/remove` 经 `fx_host_tool_call` 入 VFS；`ingestLocal` 上传入口；设置页「存储」区 S3 合约占位）。

**DevTools 模拟器实测**（`scripts/vfs-agentic-test.mjs`，devtools-sim + sim-local-live）全 PASS：

| Phase | 面 | 证据 |
|---|---|---|
| A | 五根/lane/只读闸 | `/` 恒列五根；写读回一致；7 项错误码全中（`unsafe-workspace-path`/`read-only-path`/`path-not-found`）；`/mnt` 空 lane 合法存在 |
| B | 热视图 | 同 population digest 稳定；页读游标正确；range 读回原文；mutation 后 digest 变；**旧 manifest 不见新写入**（有界陈旧快照成立） |
| C | 上传+tool.call 分析 | `ingestLocal` CSV 落 `/data/{sid}/uploaded/` → 模型 `file_read` 读到真内容 → 答对最高收入项（beta 3400） |
| D | 图片识别 | `pendingImages` → `ImageRef` → FSM base64 → ACP image block → 视觉答 "Red"（红色方块 PNG） |
| E | file_write | 模型 `file_write` → `/tmp/` 文件落 VFS 真源并可读回 |

**回归**：`fx-agentic-test.mjs` text + `get_weather` 循环 PASS；`tsc --noEmit` clean。

**施工中踩出的环境教训**（留档防复踩）：
- FSM 二进制面在此环境只认 base64 通道：裸 `ArrayBuffer` `writeFileSync` 会被字符串化为 `"[object ArrayBuffer]"`，`Uint8Array` 报 `invalid data`，无编码 `readFileSync` 返回的 Buffer 不可 `new Uint8Array` 直转——objects/ingest 统一 `arrayBufferToBase64`/`base64ToArrayBuffer`。
- 模型工具调用走 **WASI host-import `fx_host_tool_call`**（非 ACP `libfx/tool_call`），该通道不带 sessionId——file_* 会话作用域以在飞轮次 `activeDshId` 兜底（wasm 单活动会话，无歧义）。
- DevTools 模块系统不解析目录 `index` 回退（`'../vfs'` → `services/vfs.js` 不是 `services/vfs/index.js`），且**多层缓存会让被污染的模块名长期残留**——barrel 命名避开 `index`（用 `api.ts`）。

**未证/占位边界**：S3 后端仅合约占位（`S3ObjectBackend` 方法抛 `backend-unavailable`），未接未测（业主要求）；`cloud-pinned` placement 声明面在、上行通道未动工；USER_DATA_PATH/storage 在真机未实测（R 车道）；读视图是同构形状先行，不声称 nano 级 qualification 语义。

---

## §12 tool-surface 共享层（MN01 登记）

`services/vfs/tool-surface.ts` 是 `file_*` 五工具的**唯一实现源**：fx `dispatchTool` 与 nano-mini host `io.tool` 同调 `runFileTool(name, input, dshSessionId)`（`executeFileTool` 已退役，静态守卫 grep=0）。返回 `{content, isError}`；host 侧包装为 kernel `ToolCallResult`（error 形态带 `error.code`/`effect_state`/`retryable`，见 `services/nano-mini-host/io/tool.ts`）。新文件工具入本层即可双 runtime 同源。
