# scripts/dev-cli — 本地微信开发者工具调试映射

本目录是 dsh-mini 与微信开发者工具交互的**单一真源**（AGENTS.md §6）。三条通道各有边界，工具按通道组织：

```
通道 A · MCP (wechatide mcp --token, stdio JSON-RPC)     ← 模拟器 UI 验证首选
通道 B · automator (miniprogram-automator, ws)           ← 真机调试/console 唯一取道
通道 C · 官方 CLI v2 (Contents/MacOS/cli)                ← 登录/上传/预览/云操作/打开关闭
```

## lib/

| 文件 | 职责 |
|---|---|
| `lib/args.mjs` | `--flag value` / `--flag=v` / 位置参数解析；`REPO_ROOT`、`PROJECT` |
| `lib/mcp.mjs` | `McpClient`：stdio 握手 + `call/text/eval/shot/navigate/refresh/runtimeInfo`；`bridgeCount` 计数 |
| `lib/ide.mjs` | `connectIde`：AUTO_PORT → ws:9420 → `cli auto` 回退（stdout 解析实际 autoPort）；`pipeConsole`；`CLI_PATH` |
| `lib/pitfalls.mjs` | `matchPitfall`/`wrapError`/`appendPitfall`——错误出口统一 [PITFALL-n] 前缀，真源 `pitfalls.json` |
| `lib/probe.mjs` | **ProbeDriver**：单一驱动层。择路（模拟器→MCP/真机→automator/生命周期→CLI）、锚解析（`@anchor`/`--id` 动态行）、hook 白名单、mock 配对 restore、桥复用 |
| `lib/region-run.mjs` | region 三步合成：element geo → viewport 截图 → jimp 裁切（实测校比=图px/视口dp，≠wx pr） |

`anchors.json` = 一级交互锚点注册真源（`data-anchor="scope.action"`；`disc` 字段管 wx:for 动态行）。`pitfalls.json` = 机器可读踩坑真源（symptom 正则 → fix/ownerAction）。

## 工具面（ProbeDriver 薄壳）

全部工具经 `ProbeDriver` 复用同一桥会话；**禁止在顶层脚本自建桥**（`test/mn04/no-self-bridge.mjs` 静态闸；例外：`cli.mjs` 生命周期道、`console.mjs --via auto` automator 语义段）。

### 锚点/探针/注入面（MN04）

| 脚本 | 用法 | 说明 |
|---|---|---|
| `act.mjs` | `act.mjs <@anchor\|sel> <action> [--id v] [--v val] [--x --y] [--wait s] [--for sel]` | element_action 18 动作；@anchor 注册表解析，--id 拼 `[disc="v"]` |
| `inject.mjs` | `--data '{k:v}' \| --call m [--args '[]'] \| --hook H --fn src \| --mock-wx m [--result j\|--fn src] \| --restore [m]` | 四键互斥三分流：page.data / callMethod / globalData 白名单 / wx mock 配对 |
| `region.mjs` | `region.mjs <@anchor\|sel> [-o out.png] [--id v]` | 元素几何 → viewport 截图 → jimp 裁切 → `region.png`+`.json` 元数据 |
| `scene.mjs` | `scene.mjs dark\|light\|system \| --sysinfo '{..}' \| --page p [--scene n --query q] \| --read` | 主题走 settings onThemeMode 用户路径；sysinfo 为 JS 层 mock（rpx 布局不可改） |
| `reset.mjs` | `reset.mjs [--type storage\|file\|session\|auth\|webview\|compile\|filelist\|allsim\|all]` | debug_clear_cache 9 类透传 |
| `session.mjs` | `session.mjs [-f steps.txt]` | REPL/批处理会话载体——单桥跑整组动作（冷启 ~8s 摊一次） |
| `device.mjs` | `device.mjs --remote [--seconds s] [--dump-only]` | 真机拉起 + 四件套 dump `.anote/device/<ts>/`；exit 3=skip 设备缺席、4=degraded |
| `replay.mjs` | `replay.mjs --export <name> \| --run <name> [--via auto] \| --list` | generate_script 导出 → `test/replay/*.mjs`；重跑带 route 终态回读 |
| `lint.mjs` | `lint.mjs [--json]` | 锚点双向对账：未锚交互/烂锚/未注册锚 三段检出 + 存活率 |

### A · MCP 通道 —— `McpClient` 封装

| 脚本 | 用法 | 底层 tool |
|---|---|---|
| `tools.mjs` | `tools.mjs [--json]` | `tools/list` 枚举全工具面 |
| `mcp.mjs` | `mcp.mjs <tool> '<json>'` | 任意 tools/call 透传（逃逸舱门） |
| `eval.mjs` | `eval.mjs -e '() => expr' \| -f file` | `automation_evaluate` |
| `state.mjs` | `state.mjs [-k k1,k2] [--deep key]` | evaluate → route+data 投影 |
| `geo.mjs` | `geo.mjs -s '.sel[,…]' [--all]` | evaluate → boundingClientRect |
| `shot.mjs` | `shot.mjs [-o path] [--sim]` | `automation_viewport_action` / `simulator_screenshot` |
| `nav.mjs` | `nav.mjs navigateTo\|reLaunch\|redirectTo\|navigateBack [url]` | `automation_navigate` |
| `refresh.mjs` | `refresh.mjs [--wait ms]` | `simulator_refresh` + 编译沉降等待 |
| `console.mjs --via mcp` | `[--grep str]` | `get_simulator_console` 快照 |
| `network.mjs` | `[--grep str]` | `get_simulator_network` 快照 |
| `preview.mjs` | `[--timeout ms]` | `auto_preview` 任务 + 授权轮询 |

### B · automator 通道 —— `connectIde`

| 脚本 | 用法 | 说明 |
|---|---|---|
| `console.mjs --via auto` | `[--port 9420] [-e expr] [--duration s]` | **真机 console/exception 唯一取道**，console 事件实时监听 |
| `visual.mjs` | `[--port] [--out dir] [--prefix ut-]` | UT-5x 双主题截图套件 → `.anote/shots/` |

### C · 官方 CLI v2 —— `cli.mjs` 透传

`cli.mjs` 把参数直通官方 cli 二进制，自动注入 `--project <repo>`（登录态/quit 类除外）。
官方命令面（[cli.md](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.md)）：

| 类别 | 命令 |
|---|---|
| 登录 | `login` `islogin`（扫码登录，`--qr-output terminal`） |
| 预览/上传 | `preview` `upload -v x.y.z` `auto-preview`（`--info-output`） |
| 自动化 | `auto --auto-port <p>`（拉起自动化；`--auto-account` 选测试号） |
| 工程 | `open --project <abs>` `open-other` `close` `quit` `build-npm` `cache --type all` `reset-fileutils` |
| 云开发 | `cloud env list` `cloud functions list\|info\|deploy\|inc-deploy\|download` |

例：`node scripts/dev-cli/cli.mjs islogin` · `cli.mjs auto --auto-port 9602` · `cli.mjs cache --type compile`

## 通道边界与已知坑（实测登记）

> 机器可读真源 = `pitfalls.json`（`lib/pitfalls.mjs` wrapError 在错误出口自动命中 → `[PITFALL-n]` 前缀）。下表为人读索引，与 json 同步维护。

- **MCP 授权**：tools/call 返回 `-32603 Bad Request` = IDE 侧授权弹窗待批准，批准后重试。
- **evaluate 禁顶层 await**：fnSource 写 promise 链；`eval.mjs` 对裸表达式自动包 `() => (expr)`。
- **refresh 后编译窗口**：`simulator_refresh` 触发重编译期间 evaluate 超时——`refresh.mjs --wait` 沉降后再探。
- **element_action scrollTo**：需同时传 `x` 与 `y`。
- **真机 console**：MCP `get_simulator_console` 只覆盖模拟器；真机调试日志必须走 `console.mjs --via auto`（automator `console`/`exception` 事件）。
- **cli auto 端口漂移**：复用运行中 IDE 时 `--auto-port` 请求值会被忽略，实际端口从 stdout `"autoPort":N` 解析——`connectIde` 已内建。
- **nav 假超时**：`automation_navigate` 偶发响应超时但实际已跳转——`nav.mjs` 后读当前 route 如实回报。
- **auto_preview 授权**：IDE 内弹推送授权，需手动批准；`preview.mjs` 轮询任务态。
- **截图坐标系**：`simulator_screenshot` 截 OS 窗口（可被屏幕边缘裁切）；viewport_action screenshot 与 element offset 同设备坐标系，但像素密度=实测校比（图px/视口dp ≈1.465），**不是** `wx.getWindowInfo().pixelRatio`——`region.mjs`/`lib/region-run.mjs` 已内建校比解算。
- **元素可在视口外**：位移/隐藏容器的 offset 为负值属如实回报——`region` 出屏即报明错，先 `inject`/`act` 使其可见。
- **诊断 schema**：`__diagnostics(sid)` 默认 v1；`__diagnostics(sid, true)` → v2（+`storage.all`/`vfs.objects`/`errors.all`，`errors.recent` 仍 20 条截断）。`device.mjs` dump 走 v2。
- **SKIP/degraded**：`device.mjs` exit 3 = 物理设备缺席（唯一合法 skip）；设备在场但 remote/dump 失败 = exit 4 degraded + 当轮 pitfalls 登记。IDE/automation 不可达属环境失败而非设备缺席。
- **`device.mjs --dump-only`**：对已 attach 通道直接 dump 不校验物理设备在场——产物 `source:'attached-lane'` 如实标注；真机证明以 `--remote` 路径为准。
- **组件锚无自动 nav**：`@anchor` 解析仅在 `meta.page` 为 `pages/*` 路由时自动导航；组件类锚（`page:"components/..."`，宿主页记在 `note`）需调用方先 `nav` 到宿主页。
- **cli.mjs 禁重复 --project**：已内建注入，外部再传 `e.startsWith` TypeError（PITFALL-12）。

### 真机调试操作契约（实测刻死，勿踩）

1. **连接探测先行**：`mp.evaluate(() => wx.getDeviceInfo())`——`brand==='devtools'`/`platform==='devtools'` = 当前对端是模拟器；物理设备（如 `samsung/SM-S9080`）= 真机调试会话已活，`App.*` 调用自动路由真机。**已连状态绝不重发 `Tool.enableRemoteDebug`**——会重置会话让调试窗空转。
2. **连接信号**：真信号是 `mp.connection.once('Tool.onRemoteDebugConnected')` 事件；`mp.remote(true)` 的 send 响应本身会假超时（`timeout waiting for automator response`），**不要 await 它**，catch 吞掉只等事件。
3. **remote-debug 会话禁导航**：`reLaunch`/`navigateTo`/`navigateBack` 会把会话打死（`Device disconnected InternalError`）——只操作 `currentPage()` 当前页面。页对象过期报 `page is not on top of page stack`，重取 `currentPage()` 或 `pageStack()`。
4. **链路抖动**：`game-ios-debug Device disconnected InternalError` 周期性出现（DevTools 日志）；设备掉线后 `enableRemoteDebug` 重触发即可，事件窗口 60-90s。
5. **inspect ws 端点是易逝的**：日志 `RemoteDebugWindow inspectUrl ws=127.0.0.1:PORT` 的 CDP 端点随窗口生命周期生灭，不持久——别缓存。
6. **模拟器 vs 真机判定**：截图分辨率（sim iPhone 3x ≈1206px 宽）与 `getDeviceInfo().brand` 双证；`--dump-only` 产物 `source:'attached-lane'` 不证物理。

## 测试入口

| 套件 | 入口 | 通道 |
|---|---|---|
| MN04 L1 | `test/mn04/{anchors,pitfalls,lint,probe-lane,no-self-bridge,diag-v2}.mjs` | Node（无 IDE） |
| MN04 L2 | `session.mjs -f` 批处理矩阵（实测证据见 AP §11 / `docs/closure/mini-nano/1st-wave/MN04-closure.md`） | MCP（单桥复用） |
| 错误 UI 探针 | `test/mn03/ide-error-ui.mjs` | automator（经 `connectIde`） |
| durable 探针 | `test/mn02/ide-durable.mjs` | automator（经 `connectIde`） |
| agentic turn | `scripts/fx-agentic-test.mjs` `scripts/vfs-agentic-test.mjs` | automator（经 `connectIde`） |

旧入口 `scripts/dev-console.mjs` / `scripts/dev-visual.mjs` 保留为 shim，转调本目录对应实现。
