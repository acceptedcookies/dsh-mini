# cloud/durable — S3-first 单合同（EP-1）

一套 `/v1/*` 合同实现，两个入口：

| 入口 | 用途 | 测试身份面 | 读取的 env |
|------|------|------------|------------|
| `server.mjs` | 生产 | 无（`/dev/*` 不存在） | `TICKET_SECRET` `S3_*` `PUBLIC_BASE` `API_PORT` `API_BIND` |
| `dev.mjs` | 测试（已停用；重建测试环境时启用） | `/dev/ticket` `/dev/stats` | 上式 + `ADMIN_TOKEN` |

`core.mjs` 只承载合同逻辑：worker 五端点委派（state/claim/alarm）、VFS、artifacts、SigV4、`/a/{sha}`。它不 import 测试入口，也不读 `ADMIN_TOKEN`。

## 1. 合同面

- `GET /healthz`
- `POST /v1/state/{get,put-cas}`、`/v1/claim`、`/v1/alarm/{due,claim}` —— `cloud/worker/worker.mjs` 同码
- `POST /v1/vfs/{put,get,del,list}` —— SigV4 直打 S3/MinIO
- `POST /v1/artifacts/publish`、`GET /a/{sha256}[.{ext}]`
- 测试身份面（仅 `dev.mjs`）：`POST /dev/ticket`、`GET /dev/stats`（`x-admin-token` 闸）

## 2. 部署（FRD1 双入口）

| 入口 | 监听 | 目录 | env | bucket |
|------|------|------|-----|--------|
| 生产 `server.mjs` | `127.0.0.1:9097` | `/srv/dsh-mini-prod` | `/etc/dsh-mini-prod/gateway.env` | `dsh-mini-prod` |
| 测试 `dev.mjs` | `127.0.0.1:9095`（已停用） | `/srv/dsh-mini-test` | `/etc/dsh-mini-test/gateway.env` | `dsh-mini-test` |

生产由 nginx `dsh-mini.saobao.com` 反代；测试入口已随测试套件拆除而停止/禁用，重建时只走 SSH 隧道。生产入口无 `/dev/*`。
`cloud/test-s3/server.mjs` 只是测试部署 wrapper：`import "../durable/dev.mjs"`，自身不含合同逻辑；当前为重建保留。

## 3. 单向切流 / fss3 退役 runbook（2026-11-07 已执行）

1. **部署**：在生产端部署同版本 `server.mjs` + S3/MinIO，`API_BIND=127.0.0.1`，前置 NPM/反代暴露 HTTPS。
2. **真 unlock 铸票**：用生产 App 的真 `unlock` 铸票；不得走 `/dev/ticket`。
3. **生产端点复验**：按 `test/README-draft.md` 的只读 smoke 线路复验（历史 `mp-remote`/`public-surface`/`cold-state` 已随测试套件拆除）。
4. **切端点**：切 `DSH_MINI_BASE_URL` / DNS 到新端点；`services/config.ts:12` 是唯一 canonical 常量。
5. **fss3 停写**：`cloud/pod1/fss3-server.mjs` 代码冻结（不再新增功能），停止接受新写。
6. **God 验证**：用管理员 S3 只读核对新端点键/字节；确认无新写落到 fss3。
7. **退役**：删除 fss3 部署单元与代码；保留本 README 的退役记录。**禁止双写**。

2026-11-07 已执行切流；生产入口为 `https://dsh-mini.saobao.com`，POD1 fss3 已停用/删除。

### 2026-11-07 执行状态

| 步骤 | 状态 | 证据 |
|------|------|------|
| 1 部署 | ✅ | FRD1 `dsh-mini-prod-gateway.service` 9097；bucket `dsh-mini-prod` |
| 2 真 unlock 铸票 | ⏳ 待真机 | 已用生产 secret 手工票验证网关；真机 SOTER 未跑 |
| 3 生产端点复验 | ✅ | `mp-remote` 27/27、`cold-state` 10/10、`vision-dual` 7/7；`public-surface` 38/39（仅 dev-only 403 差异） |
| 4 切端点 | 🟡 | `services/config.ts` 已切 `https://dsh-mini.saobao.com`；0.3.1 已上传，待业主提交/发布 |
| 5 fss3 停写 | ✅ | 2026-11-07 09:30Z 停止/禁用 `dsh-mini-fss3`；9095/9096 关闭 |
| 6 God 验证 | ✅ | `dsh-mini-prod` 35 对象 byte-for-byte 核对；POD1 停写前 60min 0 新写 |
| 7 退役 | ✅ | `/srv/dsh-mini` + `dsh-mini-fss3.service` 已删；备份 `/srv/dsh-mini-backups/pod1-dsh-mini-20261107.tar.gz` |

## 4. fss3 冻结

- 文件：`cloud/pod1/fss3-server.mjs`
- EP-1 结束时的冻结 hash 记录在 git 历史（原 `test/mn06/fss3-freeze.json` 已随测试套件拆除；fss3 已退役）。
- 冻结期间只允许 bugfix；任何功能新增都必须先解除冻结并另立扩约。

## 5. 测试

阶段命名测试套件（`test/mn01`–`test/mn06`）已按业主决定拆除；FRD1 测试网关
`dsh-mini-test-gateway`（`127.0.0.1:9095`）已停止/禁用，测试桶 `dsh-mini-test` 保留。
`cloud/durable/dev.mjs` 与 `cloud/test-s3` 保留为重建测试环境时的入口壳。

高价值回归线路（业务 E2E、合同、unit、环境要求）登记在 `test/README-draft.md`，
重建测试体系时按该草稿收敛；不得恢复阶段命名目录。
