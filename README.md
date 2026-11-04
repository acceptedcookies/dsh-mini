# dsh-mini

DeepSeek Harness（dsh）的原生微信小程序客户端。

仓库根目录就是小程序本体：`app.json`、`app.ts`、`pages/`、`components/`、`services/` 全部直接运行在微信小程序内，没有外部 BFF、没有本仓库 server、没有 deploy 目录。

## 运行

1. 用微信开发者工具打开仓库根目录。
2. AppID 已配置为 `wx356d3abb52825466`。
3. 编译后直接进入 dsh 工作区。
4. 在「设置 → 账户」登录 nano-agent，或继续使用本地运行时离线预览。

当前有两类运行时：

- **nano-agent 运行时**：登录后，会话、消息、工具卡片与审批通过 nano-agent orchestrator 的 HTTP + WebSocket 协议产生。凭证只保存在本机 `wx.storage`，不进入小程序包。
- **本地运行时**：未登录时的离线兜底，会话与消息写入 `wx.storage`，用于界面预览与无网演示。

## 界面来源

界面不是重新设计的，而是按 `context/deepseek-harness/packages/client` 的原生结构逐层移植：

| dsh 界面 | 小程序移植 |
|---|---|
| `ui-layout/AppFrame` 三栏 shell | `pages/workspace` 的侧栏 + 会话列 + 右侧面板让位 |
| `ui-sidebar/SidebarRoot` | 鱼形 logo、`DeepSeek Harness` 字标、`新会话` 按钮、会话列表 |
| `ui-conversation/ConversationHeader` | 面包屑标题、`对话 / 轨迹` 视图标签 |
| `ui-conversation/EmptyHero` | 鱼形 logo + `探索未至之境` + `预览版` 徽标 + 工作区 chip |
| `ui-conversation/InputBar` | `components/composer-bar`：输入卡、附件、权限 chip、模型、发送/停止 |
| `ui-chat/MessageItem`、`UserMessageBubble` | `components/chat-bubble`：右对齐浅蓝用户气泡、全宽 assistant markdown |
| `ui-chat/ToolCallTree`、`ui-tool/GenericToolCard`、`DisclosureRow` | `components/tool-card`：24px 工具行（变体图标、标题、摘要点）、输入/输出展开卡；工具结果合并回调用行 |
| `ui-chat/ReasoningRow`、`TurnProcessNodeView`、`TurnNavigator` | `components/reasoning-row`、轮次标题、宽屏轮次刻度 |
| `ui-trajectory/TrajectoryView`、`TrajectoryToolbar`、`TrajectoryTimeline`、`TrajectoryTable` | `components/trajectory-view`：时长/轮次/调用折叠、搜索、三泳道时间线、请求账本与明细面板 |
| `ui-commands`、`ui-input-trigger/MenuView` | `components/command-menu`：`/` 与 composer `+` 打开的指令菜单（添加/指令分区、别名、过滤） |
| `ui-permission-presets/PermissionSelect` | composer 权限 chip + `dsh-menu` 两行选项（仅可查看/工作区内修改/完全权限/自动审查） |
| `ui-chat/MessageIconActions`、`ui-message-feedback` | `components/message-actions`：日期时钟、复制（勾选反馈）、赞/踩、分支；`components/feedback-dialog`：分类 chip、详情输入与提交 |
| `ui-goal/GoalBar` | `components/goal-bar`：composer 上方的目标条（目标标签、截断目标、内联编辑、清除） |
| `ui-approval/ApprovalPanel` | `components/approval-sheet` |
| `ui-user-questions/QuestionComposer` | `components/question-sheet`：逐题翻页、编号/多选选项、推荐标记、自定义答案、跳过/下一题/提交 |
| `ui-settings-general/SettingsRoot` | `pages/settings`：800px 面板、188px 导航、移动端横向导航 |
| `ui-sidebar-right`、`ui-sidebar-files`、`ui-sidebar-terminal`、`ui-sidebar-browser` | `components/right-panel`：文件/终端/浏览器/任务/计划/团队 |
| `ui-primitives/icons` | `components/dsh-icon` + `assets/icons`：按 dsh 原始 SVG 路径生成 |
| `ui-primitives/Menu`、`Modal`、`Toast`、`Switch` | `components/dsh-menu`、`dsh-dialog`、`dsh-toast`、`dsh-switch` |
| `ui-theme/design-platform.css` | `app.less` 中的 `--dsw-*` 设计令牌（浅色/深色两套） |

品牌资源来自 dsh 仓库：`ui-primitives/FishLogo.tsx` 的鱼形路径、`ui-chat/assets/running-whale@2x.png`。

## 小程序适配

- 全部尺寸使用 `px`，不混用 `rpx`，避免宽屏下字号被放大。
- 自定义导航读取 `wx.getMenuButtonBoundingClientRect()`，为原生胶囊预留右侧空间；侧栏、设置页、右侧面板都避让状态栏与胶囊。
- 原生 `wx.showActionSheet` / `wx.showModal` / `wx.showToast` 已替换为 dsh 风格的菜单、对话框与 toast。
- 滚动区域隐藏原生滚动条，避免覆盖内容。
- 移动端收缩侧栏、header、聊天列、composer 与设置导航，避免不必要的换行。

## 目录

```text
app.json / app.ts / app.less     小程序入口与全局设计令牌
pages/workspace                   dsh 工作区（侧栏、会话、输入框、审批）
pages/settings                    dsh 设置面板 + nano-agent 账户连接
components/                       composer-bar、command-menu、trajectory-view、chat-bubble、tool-card、reasoning-row、message-actions、feedback-dialog、goal-bar、right-panel、dsh-icon、dsh-menu、dsh-dialog、dsh-toast、dsh-switch
services/                         nano-agent HTTP/WS 运行时、本地兜底运行时、会话 store、markdown、主题、存储
types/                            ChatItem / Session / Approval / Question 数据模型
assets/                           鱼形 logo、running whale、dsh 图标
typings/                          IAppOption
```

## 当前范围

- 界面 port 范围：工作区 shell、侧栏、空态 hero、composer、消息、工具行、推理行、轮次标题/导航、消息操作、审批/提问、设置九个分节、右侧六类面板、浅色/深色主题、PC/平板/手机断点。
- 继续 1:1 对齐中的面：轮次过程折叠、提问卡逐题流程、差异块增删着色、工具子调用折叠、审批「始终允许」、各弹窗与动效的逐项对照。
- 轨迹视图：`时长`/`轮次`/`调用` 折叠、轨迹搜索、三泳道时间线、请求账本、明细面板（概述/参数/结果/思考/计时）；当前投影没有工具父子关系，`子调用` 按钮置为不可用。
- 指令与动效：`/` 指令菜单、权限选择弹窗、目标/计划/反馈/压缩/模型/导出动作；菜单、对话框、Toast、明细面板与消息均有进入/退出动效。
- 消息与 composer 细节：日期时钟、复制成功勾选、赞/踩与反馈分类弹窗（落本地，含评分持久化）、目标条内联编辑、工具输入/输出展开卡、运行中工具行、离开尾部时的回到底部按钮。
- 真实运行时已接入：nano-agent 登录、会话列表/创建/启动/输入/取消、历史分页、WebSocket 流式事件、工具调用/结果、确认请求、断线重连与 seq ack。
- 本地运行时保留为未登录时的离线兜底。
- 右侧面板：文件树接 `/workspace/files`，计划接 `/todos`；终端、浏览器、后台任务、Agent Team 按 nano-agent 当前公开能力显示真实空态。
- 外部联调：真实 nano-agent 账户、附件上传、真机弱网与逐页截图；这些需要业主账户与真机环境，不在本仓库运行 server。

## 校验

```sh
npm run typecheck
```

Less 由开发者工具的 `less` 编译插件处理。所有 WXML 使用开发者工具自带的 `wcc` 编译校验，最终以微信开发者工具为准。

## 约束

- 小程序包内不包含 AppSecret、dsh token、模型 key。
- 不在本仓库引入 BFF、本地 server 或部署目录。
- 公共协议变更必须先由业主决定并 durable 登记。
