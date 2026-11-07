# cloud/test-s3 — FRD1 测试网关与生产入口部署壳

`cloud/test-s3/server.mjs` 只是测试入口部署壳（`import "../durable/dev.mjs"`）；生产入口是
`cloud/durable/server.mjs`。2026-11-07 起 FRD1 同时承载：

- **生产**：`dsh-mini.saobao.com` → nginx `:443` → `127.0.0.1:9097`（`server.mjs`，无 `/dev/*`），
  bucket `dsh-mini-prod`。
- **测试**：`127.0.0.1:9095`（`dev.mjs`，`/dev/*` 仅本机/SSH 隧道），bucket `dsh-mini-test`。
  测试套件拆除后该网关已停止/禁用；`cloud/test-s3` 与 `dev.mjs` 保留为重建测试环境时的入口壳。

POD1 fss3 已于 2026-11-07 09:30Z 停止/禁用并删除（`/srv/dsh-mini` + 单元）；备份在 FRD1
`/srv/dsh-mini-backups/pod1-dsh-mini-20261107.tar.gz`。退役记录见 `cloud/durable/README.md`。

## 拓扑

```
生产 App（真机/DevTools）                 Node 测试 / 测试身份面
        │  https://dsh-mini.saobao.com          │  ssh -L 9095
        ▼                                       ▼
FRD1 nginx :443                          FRD1 127.0.0.1:9095
        │  proxy_pass 127.0.0.1:9097            │  cloud/test-s3/server.mjs
        ▼                                       ▼
cloud/durable/server.mjs（生产，无 /dev/*）  cloud/durable/dev.mjs（测试，/dev/*）
        │                                       │
        └──────────────┬────────────────────────┘
                       ▼
        MinIO 127.0.0.1:9000
        bucket: dsh-mini-prod（生产） / dsh-mini-test（测试）
```

## FRD1 部署（历史记录；测试网关已停用）

```bash
# MinIO（社区版单二进制，AGPLv3；dl.min.io 社区路径已 410，走 GitHub release）
curl -fL -o /tmp/minio \
  https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z
install -m 0755 /tmp/minio /usr/local/bin/minio
# /etc/minio/minio.env: MINIO_ROOT_USER / MINIO_ROOT_PASSWORD
# systemd: minio.service → minio server /srv/minio/data --address 127.0.0.1:9000 --console-address 127.0.0.1:9001

# bucket + 独立用户（只授 dsh-mini-test）
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing local/dsh-mini-test
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
mc admin policy create local dsh-mini-test-policy /tmp/dsh-mini-test-policy.json
mc admin policy attach local dsh-mini-test-policy --user "$S3_ACCESS_KEY_ID"

# 网关（Node 24，仅内置模块；/srv/dsh-mini-test 下放 durable/worker/lib/test-s3 四目录）
# /etc/dsh-mini-test/gateway.env: TICKET_SECRET ADMIN_TOKEN S3_* API_PORT API_BIND PUBLIC_BASE
systemctl enable --now dsh-mini-test-gateway
curl http://127.0.0.1:9095/healthz
```

## 生产切流（2026-11-07）

- **DNS**：`dsh-mini.saobao.com` A → `51.83.11.12`（`saobao.com` zone，DNS-only、未走 Cloudflare 代理）。
- **FRD1 nginx**：`/etc/nginx/sites-available/dsh-mini.saobao.com`
  - `:80` 只做 ACME challenge + 301 到 HTTPS；
  - `:443` 反代 `http://127.0.0.1:9097`（生产入口 `cloud/durable/server.mjs`）；
  - 公网只放 `/v1/`、`/healthz`、`/a/`；`/dev/` 与其余路径一律 404；
  - `client_max_body_size 16m`（VFS 8MB + base64 余量）。
- **证书**：Let's Encrypt `dsh-mini.saobao.com`（certbot webroot，`certbot.timer` 自动续期）。
- **生产网关**：`/etc/dsh-mini-prod/gateway.env`（600）→ `API_PORT=9097`、`API_BIND=127.0.0.1`、
  `S3_BUCKET=dsh-mini-prod`、`PUBLIC_BASE=https://dsh-mini.saobao.com`、
  `TICKET_SECRET` 与 POD1 fss3/真云 unlock 同值；systemd `dsh-mini-prod-gateway.service`。
- **数据迁移**：只迁真实 oid `ogtyS5GNQegjCKFiERFiYnUBpjVU`（31 个对象 + 4 个 artifacts）
  到 `dsh-mini-prod`；测试 oid 未迁。迁移后 `state/get` 200、`vfs/list` 19 keys。
- **App**：`services/config.ts` 的 `DSH_MINI_BASE_URL=https://dsh-mini.saobao.com`；
  `.local.development.json`/`services/fx/dev-config.ts` 同步该域；微信公众平台已加入
  request 合法域名。
- **sweeper**：`cloud/functions/sweeper` 默认 `WORKER=https://dsh-mini.saobao.com`；2026-11-07
  已重部署 HEAD 构建（`host.cjs`/`kernel.cjs` 与本地同 hash）；真 alarm at-most-once 实测通过
  （合成 oid；证据见 `docs/closure/mini-nano/1st-wave/MN06-closure.md` §8.1 `B-04`）。
- **验证**：`mp-remote` 27/27、`cold-state` 10/10、`vision-dual` 7/7（生产公网 artifact →
  magpie `Red`）；`public-surface` 38/39，唯一差异是测试脚本期望 dev 入口 `/dev/ticket` 403，
  生产入口按合同返回 404。
- **POD1**：fss3 已停止/禁用并删除（`/srv/dsh-mini` + `dsh-mini-fss3.service`）；备份在 FRD1
  `/srv/dsh-mini-backups/pod1-dsh-mini-20261107.tar.gz`。

## 本地接入（SSH 隧道，不暴露公网）

```bash
ssh -N -L 9095:127.0.0.1:9095 frd1   # 测试入口（网关已停用；重建时再开）
ssh -N -L 9000:127.0.0.1:9000 frd1   # 可选：S3 直探（重建测试时使用）

# .local.development.json → cloud.durable_url = https://dsh-mini.saobao.com（生产 App 面）
# 测试身份面/测试数据仍走隧道：DURABLE=http://127.0.0.1:9095
node scripts/fx-dev-config.mjs
```

DevTools 侧 `project.config.json` 已是 `urlCheck:false`，模拟器可直接访问 `127.0.0.1:9095`。
测试网关停用期间 App 测试身份面不可用；重建时由网关 `/dev/ticket` 铸票，
challenge/SOTER 走 mock、数据面走真网关——**控制面 mock，数据面真**。

## 测试入口

阶段命名测试套件（`test/mn01`–`test/mn06`）已拆除，本文档不保留其命令。
高价值回归线路（Node 真端点、MinIO 条件写、DevTools 真 App）登记在
`test/README-draft.md`；重建测试体系时按该草稿重新接线。

## 实测语义（2026-11-07）

- MinIO 条件写：`If-Match` / `If-None-Match:*` 均生效；并发同 etag 两写 → `200,412`（`s3-probe` 9/9）。
- worker 五端点（state/claim/alarm）经 MinIO 全绿：`cold-state` 10/10、`public-surface` 39/39。
- VFS 车道全绿：`mp-remote` 27/27、`tool-observability` 21/21。
- DevTools 真 App → 网关 → MinIO：`ide-durable` **6 PASS + 3 NOTE**（D/E 控制面 mock 记 NOTE；NOTE 单列、不计 PASS）。不写全绿分母。真机车道另跑。

## 已知限制

- 生产网关 `PUBLIC_BASE=https://dsh-mini.saobao.com`；`vision-dual` 7/7 PASS
  （B1 `https:` 视觉应答 `Red`，B2 `data:` 正常）@ 2026-11-07T09:27Z。
  测试网关 `PUBLIC_BASE=http://127.0.0.1:9095`，`https:` 分支不适用（本地 HTTP 不可被上游抓取）。
- 网关不跑 30s sweeper；生产 alarm 真链由 `cloud/functions/sweeper` 承担（已部署）。
- 测试数据按 `dsh-mini/{kind}/{oid}/` 隔离；teardown 用 `mc rm --recursive --force` 删前缀。
- 生产合同变更不走本目录；本目录仅测试基础设施。
