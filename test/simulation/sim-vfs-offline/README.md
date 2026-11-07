# sim-vfs-offline

## 下一步

- 先在手机本地写入并删除。
- 再铸票推到公网，断言写入出现、删除不出现。

无票写入被拒 → 恢复票据后写入 → 删除后不复活。

- mock：本地真实 `/v1/vfs/*`，无票请求不带 Authorization。
- live：测试网关未启用时 `live-blocked`。
- 页面：workspace 三张截图。
