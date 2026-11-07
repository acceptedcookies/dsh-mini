# sim-claim-conflict

## 下一步

- 先占用当前会话的 claim。
- 再让 App 自己发送，断言页面出现「会话写者冲突」。

第二写者先持有 claim，App 侧再申请时看到冲突，释放后可以重试。

- mock / live 都走真实 `/v1/claim`。live 在测试网关停用时 `live-blocked`。
- 页面截图覆盖启动、输入、冲突后的会话页。
