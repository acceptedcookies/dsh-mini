# cloud/durable — S3-first 单合同（EP-1）

一套 `/v1/*` 合同实现，两个入口：

| 入口 | 用途 | 测试身份面 | 读取的 env |
|------|------|------------|------------|
| `server.mjs` | 生产 | 无（`/dev/*` 不存在） | `TICKET_SECRET` `S3_*` `PUBLIC_BASE` `API_PORT` `API_BIND` |
| `dev.mjs` | 测试（FRD1 / SSH 隧道） | `/dev/ticket` `/dev/stats` | 上式 + `ADMIN_TOKEN` |

`core.mjs` 只承载合同逻辑：worker 五端点委派（state/claim/alarm）、VFS、artifacts、SigV4、`/a/{sha}`。它不 import 测试入口，也不读 `ADMIN_TOKEN`。

## 1. 合同面

- `GET /healthz`
- `POST /v1/state/{get,put-cas}`、`/v1/claim`、`/v1/alarm/{due,claim}` —— `cloud/worker/worker.mjs` 同码
- `POST /v1/vfs/{put,get,del,list}` —— SigV4 直打 S3/MinIO
- `POST /v1/artifacts/publish`、`GET /a/{sha256}[.{ext}]`
- 测试身份面（仅 `dev.mjs`）：`POST /dev/ticket`、`GET /dev/stats`（`x-admin-token` 闸）

## 2. 部署（FRD1 测试面）

```bash
# /srv/dsh-mini-test 下需要 durable/ worker/ lib/ test-s3/ 四个目录
# gateway.env（600）：TICKET_SECRET ADMIN_TOKEN S3_* API_PORT API_BIND PUBLIC_BASE
systemctl enable --now dsh-mini-test-gateway
curl http://127.0.0.1:9095/healthz
```

`cloud/test-s3/server.mjs` 只是部署 wrapper：`import "../durable/dev.mjs"`，自身不含合同逻辑。

## 3. 单向切流 / fss3 退役 runbook（EP-1 不执行）

1. **部署**：在生产端部署同版本 `server.mjs` + S3/MinIO，`API_BIND=127.0.0.1`，前置 NPM/反代暴露 HTTPS。
2. **真 unlock 铸票**：用生产 App 的真 `unlock` 铸票；不得走 `/dev/ticket`。
3. **生产端点复验**：对生产端点跑 `mp-remote` / `public-surface` / `cold-state`（只读 + 测试 oid）。
4. **切端点**：切 `DSH_MINI_BASE_URL` / DNS 到新端点；`services/config.ts:12` 是唯一 canonical 常量。
5. **fss3 停写**：`cloud/pod1/fss3-server.mjs` 代码冻结（不再新增功能），停止接受新写。
6. **God 验证**：用管理员 S3 只读核对新端点键/字节；确认无新写落到 fss3。
7. **退役**：删除 fss3 部署单元与代码；保留本 README 的退役记录。**禁止双写**。

旧客户端强制更新窗口在生产切流时另行处理；EP-1 只交 runbook，不宣称生产已切换。

## 4. fss3 冻结

- 文件：`cloud/pod1/fss3-server.mjs`
- EP-1 结束时的冻结 hash 记录在 `test/mn06/fss3-freeze.json`（由 `docs-check.mjs` 校验）。
- 冻结期间只允许 bugfix；任何功能新增都必须先解除冻结并另立扩约。

## 5. 测试

```bash
node test/mn06/env.mjs                 # 600/env/端点白名单
node test/mn06/entry-isolation.mjs     # 生产/测试入口隔离
node test/mn06/parity.mjs              # 旧 server vs 新 core golden A/B
node test/mn06/regression.mjs          # 全量回归
```

测试端点固定 `http://127.0.0.1:9095`；所有套件由 `test/mn06/regression.mjs` 注入环境，禁止默认打 POD1。
