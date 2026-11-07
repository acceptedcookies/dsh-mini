# sim-claim-conflict

第二写者先持有 claim，App 侧再申请时看到冲突，释放后可以重试。

- mock / live 都走真实 `/v1/claim`。live 在测试网关停用时 `live-blocked`。
- 页面截图覆盖启动、输入、冲突后的会话页。
