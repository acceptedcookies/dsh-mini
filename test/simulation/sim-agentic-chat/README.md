# sim-agentic-chat

输入 → 发送 → 停止 → 错误可见。

- mock：scripted LLM 返回固定回复；App 仍走真实 composer/send。
- live：真实 magpie 路由。本机没有独立路由时 `live-blocked`，页面错误态不记 live-pass。
- 数据：用户文本留在会话；停止后状态不再 running；错误进入页面 error 或 error bus。
- 截图：输入、发送后、停止/错误。
