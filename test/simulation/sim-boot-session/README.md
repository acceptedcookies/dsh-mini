# sim-boot-session

冷启动 → 会话 → prompt/turn → 重载后续跑。

- mock：本地真实 `/v1/state/*`，scripted LLM 只替换上游。当前 3426 的 sim 进程没有加载 durable 面，不把 404 记成 mock-pass。
- live：FRD1 测试网关。网关停用时 `live-blocked`，不用本地内存 S3 冒充。
- 数据：checkpoint 可读回；并发旧 etag 写返回 412。
- 截图：启动、输入后、发送后，落本目录 `evidence/`。
