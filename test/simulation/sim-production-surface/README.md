# sim-production-surface

## 下一步

- 用手机自己的票只读自己的 state 和 vfs。
- 断言另一个 oid 的键读不到。

只读。mock 打本地测试入口，live 打 `https://dsh-mini.saobao.com`。

断言：`/healthz` 200、无票 401、`/dev/ticket` 在生产为 404、带测试票不能读到另一身份的数据。
不写生产，不使用真实用户 oid。
