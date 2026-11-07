# scripts/dev-cli — 微信开发者工具 AI 增强调试映射

本目录是 dsh-mini 与微信开发者工具交互的**单一真源**（AGENTS.md §6）。DevTools 2.02.2609250 起工具面升级为「MCP + skill-cli + 官方 CLI + IDE agent」四层，本目录对应扩为**五通道**：

```
通道 A · MCP        wechatide mcp --token（stdio JSON-RPC）       ← 模拟器结构化工具面（49 tools）
通道 B · automator  miniprogram-automator（ws）                    ← 真机调试/console 唯一取道
通道 C · CLI v2     Contents/MacOS/cli（login/upload/preview/…）  ← 生命周期/云/agent/auto-replay
通道 D · skill      wechatide -c <client> <tool>（skill-cli）      ← 一次性工具调用（AI 增强新增）
通道 E · agent      cli agent <subcommand>                         ← IDE 内置 AI agent（非确定性，探索用）
```

**择路原则**：模拟器操作/观测 → MCP；只读状态/测试号/doctor → skill；真机 remote/console → automator；生命周期 → CLI；AI 探索 → agent。`--via` 仅调试覆写；`ProbeDriver` 内建 skill→MCP 回落。

## 快速开始

```bash
node scripts/dev-cli/index.mjs --list          # 命令发现（AI agent 入口）
node scripts/dev-cli/doctor.mjs --probe        # 升级后先跑：版本/登录/token/MCP/skill/automator
node scripts/dev-cli/tools.mjs --full          # 49 工具目录（R=只读 W=写 ?=未标注）
node scripts/dev-cli/catalog.mjs --refresh     # 写目录缓存
node scripts/dev-cli/catalog.mjs --diff        # DevTools 升级后差分
node scripts/dev-cli/session.mjs --via skill   # 单进程 REPL（skill 通道）
```

## lib/（单一实现层）

| 文件 | 职责 |
|---|---|
| `lib/args.mjs` | flag 解析 + `boolFlag/numberFlag/jsonFlag/wantJson`；`REPO_ROOT`、`PROJECT`、`ANOTE_DIR` |
| `lib/devtools.mjs` | DevTools 安装包/skill 版本、MCP/CLI token 来源、clientName、项目配置摘要；**凭证只报 present/source** |
| `lib/mcp.mjs` | `McpClient`：stdio 握手 + `tools()/tool()/call/text/eval`；`serverInfo`、stderr、授权 pending 标记；`bridgeCount` |
| `lib/ide.mjs` | `connectIde`（AUTO_PORT → ws:9420 → cli auto；支持显式 wsEndpoint）；`portAlive`；`cliRun`；`pipeConsole`；`CLI_PATH` |
| `lib/channels.mjs` | `SkillChannel`（skill-cli 参数按 tools.yaml schema 过滤）、`AgentChannel`（cli agent）、`CliChannel`、`runCapture`、`channelStatus` |
| `lib/catalog.mjs` | MCP tools/list × skill tools.yaml → 归一目录；merge/diff/summary/cache；只读/写/废弃标注 |
| `lib/tasks.mjs` | pending/taskId 提取 + `polling_task_result` 轮询 + 终态判定（preview/task/session 共用） |
| `lib/report.mjs` | 统一输出信封 `dsh-mini.devcli.v1`；`runMain` 包装 |
| `lib/registry.mjs` | 本仓 dev-cli 命令注册表（35 命令）；`assertRegistry` 双向对账 |
| `lib/doctor.mjs` | 健康检查（文件面 + 在线 skill/MCP/automator） |
| `lib/pitfalls.mjs` | `matchPitfall`/`wrapError`/`classifyError`/`appendPitfall`——错误出口统一 `[PITFALL-n]` + kind |
| `lib/probe.mjs` | **ProbeDriver**：五通道择路、锚解析、hook 白名单、mock 配对 restore、桥复用、catalog/task/doctor 便捷面 |
| `lib/region-run.mjs` | region 三步合成：element geo → viewport 截图 → jimp 裁切 |

`anchors.json` = 一级交互锚点注册真源（`data-anchor="scope.action"`；`disc` 字段管 wx:for 动态行）。`pitfalls.json` = 机器可读踩坑真源（symptom 正则 → fix/ownerAction）。

## 工具面（ProbeDriver 薄壳）

全部工具经 `ProbeDriver` 复用同一桥会话；**禁止在顶层脚本自建桥**（例外：`cli.mjs` 生命周期道、`index.mjs` 纯分发器、`console.mjs --via auto` automator 语义段）。

### 统一入口 / AI 增强工具

| 脚本 | 用法 | 说明 |
|---|---|---|
| `index.mjs` | `index.mjs [--list\|--json] <command> [...]` | 单入口/命令发现；透传到对应脚本 |
| `doctor.mjs` | `doctor.mjs [--json] [--offline] [--probe]` | DevTools/skill/MCP/automator/项目健康检查；升级后先跑 |
| `catalog.mjs` | `catalog.mjs [--json] [--full] [--tool n] [--refresh] [--diff] [--via mcp\|skill]` | 工具目录 dump/diff/缓存 |
| `testaccount.mjs` | `testaccount.mjs list\|getTicket\|setTicket\|refreshTicket [--ticket t] [--via skill\|mcp]` | 测试号/登录 ticket（DevTools 新增） |
| `task.mjs` | `task.mjs <taskId> [--timeout ms] [--interval ms] [--via mcp\|skill]` | 异步任务轮询（pending/taskId 语义） |
| `agent.mjs` | `agent.mjs <start\|tool\|chat\|render\|card-click\|get-dom\|get-card-image\|clear\|debug\|overlay\|detail-close> [...]` | IDE 内置 AI agent；**非确定性，禁止用于 GSTH 判定** |
| `skill.mjs` | `skill.mjs <tool> '<json-args>' [--json] [--client name]` | skill-cli 透传（一次性，不建 MCP 桥） |

### 锚点/探针/注入面（DevTools）

| 脚本 | 用法 | 说明 |
|---|---|---|
| `act.mjs` | `act.mjs <@anchor\|sel> <action> [--id v] [--v val] [--x --y] [--wait s] [--for sel] [--via mcp\|skill]` | element_action 18 动作；@anchor 注册表解析 |
| `inject.mjs` | `--data '{k:v}' \| --call m [--args '[]'] \| --hook H --fn src \| --mock-wx m [--result j\|--fn src] \| --restore [m] [--via]` | 四键互斥三分流：page.data / callMethod / globalData 白名单 / wx mock |
| `region.mjs` | `region.mjs <@anchor\|sel> [-o out.png] [--id v] [--via]` | 元素几何 → viewport 截图 → jimp 裁切 |
| `scene.mjs` | `scene.mjs dark\|light\|system \| --sysinfo '{..}' \| --page p [--scene n --query q] \| --read [--via]` | 主题走 settings onThemeMode 用户路径；sysinfo 为 JS 层 mock |
| `reset.mjs` | `reset.mjs [--type storage\|file\|session\|auth\|webview\|compile\|filelist\|allsim\|all] [--via]` | debug_clear_cache 9 类透传 |
| `session.mjs` | `session.mjs [--via mcp\|skill] [-f steps.txt]` | REPL/批处理单桥会话载体 |
| `device.mjs` | `device.mjs --remote [--seconds s] [--dump-only]` | 真机拉起 + 四件套 dump；exit 3=skip、4=degraded |
| `replay.mjs` | `replay.mjs --export <name> \| --run <name> [--via] \| --list \| --auto-replay [--config path]` | generate_script 导出/重跑；auto-replay 透传 |
| `lint.mjs` | `lint.mjs [--json]` | 锚点双向对账 |

### A · MCP / D · skill 通道 —— `McpClient` / `SkillChannel`

| 脚本 | 用法 | 底层 tool |
|---|---|---|
| `tools.mjs` | `tools.mjs [--json] [--full] [--schema n] [--scenes] [--diff] [--refresh] [--via mcp\|skill]` | 目录枚举/差分 |
| `mcp.mjs` | `mcp.mjs <tool> '<json>' [--via mcp\|skill] [--timeout ms] [--json]` | 任意 tools/call 透传（逃逸舱门） |
| `eval.mjs` | `eval.mjs -e '() => expr' \| -f file [--via]` | `automation_evaluate` |
| `state.mjs` | `state.mjs [-k k1,k2] [--deep key] [--via]` | evaluate → route+data 投影 |
| `geo.mjs` | `geo.mjs -s '.sel[,…]' [--all] [--via]` | evaluate → boundingClientRect |
| `shot.mjs` | `shot.mjs [-o path] [--sim] [--via]` | `automation_viewport_action` / `simulator_screenshot` |
| `nav.mjs` | `nav.mjs navigateTo\|reLaunch\|redirectTo\|navigateBack [url] [--via]` | `automation_navigate` |
| `refresh.mjs` | `refresh.mjs [--wait ms] [--via]` | `simulator_refresh` + 编译沉降 |
| `console.mjs` | `console.mjs [--via mcp\|skill\|auto] [--grep str]` | 快照 / 真机实时监听 |
| `network.mjs` | `network.mjs [--via mcp\|skill] [--grep str]` | `get_simulator_network` |
| `preview.mjs` | `preview.mjs [--timeout ms] [--interval ms] [--via]` | `auto_preview` + 任务轮询 |

### B · automator 通道 —— `connectIde`

| 脚本 | 用法 | 说明 |
|---|---|---|
| `console.mjs --via auto` | `[--port 9420] [-e expr] [--duration s]` | **真机 console/exception 唯一取道** |
| `visual.mjs` | `[--port] [--out dir] [--prefix ut-]` | UT-5x 双主题截图套件 |
| `device.mjs` | `--remote` / `--dump-only` | 真机 remote + diag/storage/console/shots |

### C · 官方 CLI v2 —— `cli.mjs` 透传

`cli.mjs` 自动注入 `--project <repo>`（登录态/quit/engine 类除外）；`--json` 捕获 `{code,stdout,stderr}`。

| 类别 | 命令 |
|---|---|
| 登录 | `login` `islogin`（扫码登录，`--qr-output terminal`） |
| 预览/上传 | `preview` `upload -v x.y.z` `auto-preview` |
| 自动化 | `auto --auto-port <p>` · `auto-replay --replay-all --replay-config-path <p>` |
| 工程 | `open` `open-other` `close` `quit` `build-npm` `cache --type all` `reset-fileutils` `engine build <path>` |
| 云开发 | `cloud env list` `cloud functions list\|info\|deploy\|inc-deploy\|download` |
| AI agent | `agent start\|tool\|chat\|render\|card-click\|get-dom\|get-card-image\|clear\|debug\|overlay\|detail-close` |

例：`node scripts/dev-cli/cli.mjs islogin` · `cli.mjs auto-replay --replay-all --replay-config-path ./replay.json` · `cli.mjs agent chat --query '检查首页'`

## 通道边界与已知坑（实测登记）

> 机器可读真源 = `pitfalls.json`（`lib/pitfalls.mjs` wrapError 在错误出口自动命中 → `[PITFALL-n]` 前缀）。下表为人读索引，与 json 同步维护。

- **MCP Token**：2.02.2609250 起 MCP 入口强制独立 Token（`mcpTokenRequired: true`），与 CLI 可选令牌不同源；缺 Token 直接拒绝握手（PITFALL-19）。skill-cli 的 CLI Token 未启用时不验。
- **skill 版本关系**：`check_wechatide_status.versionRelation` 必须 `equal`/`agent_ahead`；`agent_behind` 时整目录同步 skill（PITFALL-20）。
- **skill 参数过滤**：skill-cli 对 inputSchema 之外的参数只告警（`未知参数 … 已忽略`，PITFALL-21）；`SkillChannel` 按 tools.yaml schema 过滤并跳过 `fixed` 字段。
- **pending/taskId**：需要授权/扫码/确认的 toolCall 返回 `pending + taskId`；用 `task.mjs`/`preview.mjs` 轮询，**不要重发原写操作**（PITFALL-27）。
- **agent 非确定性**：`cli agent` 由 LLM 驱动，不能作为 GSTH/验收判定通道；只用于探索/卡片渲染/取图（PITFALL-22）。
- **project_setting_* 废弃**：直接读写 `project.config.json` / `project.private.config.json`（PITFALL-23）。
- **auto-replay 配置**：`cli auto-replay` 需要 `--replay-config-path`（PITFALL-24）；`replay.mjs --auto-replay --config <path>` 已封装。
- **MCP 授权**：`-32603` = MCP Token 缺失/无效或 IDE 侧授权未完成；2.02.2609250 起敏感操作改走 `pending + taskId`，用 `task.mjs` 轮询（PITFALL-1）。
- **evaluate 禁 await**：fnSource 写 promise 链；2.02.2609250 实测 async 函数内的 await 仍被拒（PITFALL-2）。
- **refresh 后编译窗口**：2.02.2609250 实测 500ms 仍失败、2s 恢复；新工具支持 `wait`/`waitForSelector`，优先等目标出现（PITFALL-3）。
- **element_action scrollTo**：需同时传 `x` 与 `y`；目标必须是 scroll-view（`#chat-scroll`/`.viewport`），非 scroll-view 报 `$$` 未定义（PITFALL-8/30）。
- **console/network command**：`command: 'all'` 在 2.02.2609250 已被接受（无行号）；要行号/过滤仍用 `grep -n .` / `grep -n -i "词"`（PITFALL-5）。
- **真机 console**：MCP `get_simulator_console` 只覆盖模拟器；真机调试日志必须走 `console.mjs --via auto`（PITFALL-13）。
- **cli auto 端口漂移**：复用运行中 IDE 时 `--auto-port` 请求值会被忽略，实际端口从 stdout `"autoPort":N` 解析——`connectIde` 已内建（PITFALL-4）。
- **nav 假超时**：2.02.2609250 实测 MCP/skill 双通道均返回 success，未复现；仍保留 route 回读防御（PITFALL-7）。
- **截图坐标系**：`simulator_screenshot` 仍截 OS 窗口（2.02.2609250 实测 raw 1094×1460 vs 视口 1032×1376）；viewport_action screenshot 与 element offset 同设备坐标系，像素密度=实测校比（图px/视口dp ≈1.465），**不是** `wx.getWindowInfo().pixelRatio`（PITFALL-10）。
- **元素可在视口外**：位移/隐藏容器的 offset 为负值属如实回报——`region` 出屏即报明错（PITFALL-11）。
- **诊断 schema**：`__diagnostics(sid)` 默认 v1；`__diagnostics(sid, true)` → v2（+`storage.all`/`vfs.objects`/`errors.all`）。`device.mjs` dump 走 v2。
- **SKIP/degraded**：`device.mjs` exit 3 = 物理设备缺席（唯一合法 skip）；设备在场但 remote/dump 失败 = exit 4 degraded + 当轮 pitfalls 登记。
- **组件锚无自动 nav**：`@anchor` 解析仅在 `meta.page` 为 `pages/*` 路由时自动导航；组件类锚需调用方先 `nav` 到宿主页。
- **cli.mjs 禁重复 --project**：已内建注入，外部再传会 TypeError（PITFALL-12）。

### 2.02.2609250 升级对既有坑的影响（实测）

| 坑 | 根因侧 | 升级后 |
|---|---|---|
| PITFALL-1 MCP 授权 `-32603` | DevTools | **改善**：敏感操作改 `pending + taskId`；MCP Token 强制 |
| PITFALL-2 evaluate `await` | DevTools | **未修**：async 函数内 await 仍拒；用 promise 链 |
| PITFALL-3 refresh 编译窗 | DevTools | **未修**：500ms 仍失败、2s 恢复；新增 `wait`/`waitForSelector` 缓解 |
| PITFALL-5 console/network grep | DevTools | **部分改善**：`command:'all'` 已接受（无行号） |
| PITFALL-6 截图相对路径 | DevTools | **未修**：仍 EROFS；必须绝对路径 |
| PITFALL-7 navigate 假超时 | DevTools | **未复现**：MCP/skill 双通道返回 success |
| PITFALL-8 scrollTo x/y | DevTools | **未修**：仍要求 x+y；非 scroll-view 报 `$$` |
| PITFALL-10 simulator_screenshot 坐标系 | DevTools | **未修**：raw 1094×1460 vs 视口 1032×1376 |
| PITFALL-13 automator 非 JSON 帧崩 | 上游库 | **未修**：DevTools 升级不换 `miniprogram-automator` |
| PITFALL-16/17 分包/cloud 配置 | 本仓 App | 与 DevTools 无关 |
| PITFALL-12 cli 重复 `--project` | 本仓封装 | 已由 `cliRun` 去重 |

**结论**：这次升级主要是 **AI 集成层**（skill 包、agent、结构化 pending/taskId、`wait`/`waitForSelector`、工具描述），不是底层 flaky 行为的整修。低层坑（await、截图路径/坐标、scrollTo、refresh 编译窗、remote-debug 生命周期）仍按原契约处理；其中一部分确实是 DevTools/上游库侧问题，另一部分是本仓 App/封装侧问题。

### 真机调试操作契约（实测刻死，勿踩）

1. **连接探测先行**：`mp.evaluate(() => wx.getDeviceInfo())`——`brand==='devtools'`/`platform==='devtools'` = 当前对端是模拟器；物理设备 = 真机调试会话已活。**已连状态绝不重发 `Tool.enableRemoteDebug`**——会重置会话让调试窗空转。
2. **连接信号**：真信号是 `mp.connection.once('Tool.onRemoteDebugConnected')` 事件；`mp.remote(true)` 的 send 响应本身会假超时，**不要 await 它**，catch 吞掉只等事件。
3. **remote-debug 会话禁导航**：`reLaunch`/`navigateTo`/`navigateBack` 会把会话打死——只操作 `currentPage()` 当前页面。
4. **链路抖动**：`game-ios-debug Device disconnected InternalError` 周期性出现；设备掉线后 `enableRemoteDebug` 重触发即可，事件窗口 60-90s。
5. **inspect ws 端点是易逝的**：日志 `RemoteDebugWindow inspectUrl ws=127.0.0.1:PORT` 的 CDP 端点随窗口生命周期生灭，不持久——别缓存。
6. **模拟器 vs 真机判定**：截图分辨率与 `getDeviceInfo().brand` 双证；`--dump-only` 产物 `source:'attached-lane'` 不证物理。

## DevTools 升级流程（AI 增强形态）

1. `node scripts/dev-cli/doctor.mjs --probe` —— 版本/skill/登录/token/MCP 49 工具/automator 端口；
2. `node scripts/dev-cli/catalog.mjs --refresh` —— 写 `.anote/dev-cli/catalog.json`；
3. 升级 DevTools 后：`node scripts/dev-cli/catalog.mjs --diff` —— 检出工具增/删/schema/只读标注变化；
4. 若 MCP 与 skill 工具数不一致：`doctor` 的 `mcp.skill.parity` 会 warn；先同步 skill 再重跑；
5. 新工具先在 `mcp.mjs`/`skill.mjs` 逃逸舱门试，再决定是否加薄壳。

## 验证入口

阶段命名测试套件已拆除；当前只保留 dev-cli 自身的健康检查与单桥批处理：

| 面 | 入口 | 通道 |
|---|---|---|
| 批处理 | `session.mjs -f` | MCP / skill（单桥复用） |
| 健康检查 | `doctor.mjs [--probe]` | 文件面 + 在线通道 |
| 工具目录 | `catalog.mjs --refresh/--diff` | MCP / skill |

高价值回归线路登记见 `test/README-draft.md`（待重建）。

旧入口 `scripts/dev-console.mjs` / `scripts/dev-visual.mjs` 保留为 shim，转调本目录对应实现。legacy 专项探针（`byok-probe`/`sim-toolcall-probe`/`md-*`/`unlock-shot`）已收编 `ProbeDriver`，保留为历史入口。
