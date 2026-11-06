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
| `lib/mcp.mjs` | `McpClient`：stdio 握手 + `call/text/eval/shot/navigate/refresh/runtimeInfo` |
| `lib/ide.mjs` | `connectIde`：AUTO_PORT → ws:9420 → `cli auto` 回退（stdout 解析实际 autoPort）；`pipeConsole`；`CLI_PATH` |

## 工具面（按通道）

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

- **MCP 授权**：tools/call 返回 `-32603 Bad Request` = IDE 侧授权弹窗待批准，批准后重试。
- **evaluate 禁顶层 await**：fnSource 写 promise 链；`eval.mjs` 对裸表达式自动包 `() => (expr)`。
- **refresh 后编译窗口**：`simulator_refresh` 触发重编译期间 evaluate 超时——`refresh.mjs --wait` 沉降后再探。
- **element_action scrollTo**：需同时传 `x` 与 `y`。
- **真机 console**：MCP `get_simulator_console` 只覆盖模拟器；真机调试日志必须走 `console.mjs --via auto`（automator `console`/`exception` 事件）。
- **cli auto 端口漂移**：复用运行中 IDE 时 `--auto-port` 请求值会被忽略，实际端口从 stdout `"autoPort":N` 解析——`connectIde` 已内建。
- **nav 假超时**：`automation_navigate` 偶发响应超时但实际已跳转——`nav.mjs` 后读当前 route 如实回报。
- **auto_preview 授权**：IDE 内弹推送授权，需手动批准；`preview.mjs` 轮询任务态。

## 测试入口（既有套件沿用）

| 套件 | 入口 | 通道 |
|---|---|---|
| 错误 UI 探针 | `test/mn03/ide-error-ui.mjs` | automator（经 `connectIde`） |
| durable 探针 | `test/mn02/ide-durable.mjs` | automator（经 `connectIde`） |
| agentic turn | `scripts/fx-agentic-test.mjs` `scripts/vfs-agentic-test.mjs` | automator（经 `connectIde`） |

旧入口 `scripts/dev-console.mjs` / `scripts/dev-visual.mjs` 保留为 shim，转调本目录对应实现。
