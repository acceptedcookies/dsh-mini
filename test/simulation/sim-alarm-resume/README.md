# sim-alarm-resume

创建已到期 alarm，第一次 claim 消费，第二次 claim 不再拿到同一条。

- mock：本地真实 `/v1/alarm/{due,claim}`，时钟用请求里的 `now`。
- live：测试网关未启用时 `live-blocked`。云函数 sweeper 不在本进程里伪造。
- 页面截图覆盖启动、输入、结束后。
