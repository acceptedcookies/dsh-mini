# sim-vfs-roundtrip

## 下一步

- 列表必须包含刚写的键。
- 公网 `/a/{sha}` 回读必须比对正文，不只比对长度。

文件写入、列表、range 读、删除、artifact 发布与 `/a/` 回读，以及路径穿越和超限拒绝。

- mock：本地真实 `/v1/vfs/*`，scripted LLM 只替换上游。
- live：同一真实合同打到测试网关；测试网关未启用时 `live-blocked`。
- 页面：workspace 启动、输入文件名、发送后的会话截图。
