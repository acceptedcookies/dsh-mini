# cloud/test-s3 — 专用测试 S3 网关（EP-1 W1）

测试基础设施，**不是生产合同实现**。生产入口是 `cloud/durable/server.mjs`；当前生产流量仍在
`cloud/pod1/fss3-server.mjs`，切流/退役按 `cloud/durable/README.md` 的 7 步 runbook 另行操作。
目的：让 App 的现有 `/v1/*` 车道在独立 MinIO 上跑真链路，与 POD1 数据剥离。

## 拓扑

```
DevTools 模拟器 / Node 测试
        │  /v1/state/* /v1/claim /v1/alarm/* /v1/vfs/* /v1/artifacts/*
        ▼
cloud/test-s3/server.mjs（FRD1 127.0.0.1:9095）
        ├─ worker.mjs 同码委派（state/claim/alarm）
        └─ SigV4 直打 MinIO（vfs/artifacts）
                    │
                    ▼
        MinIO RELEASE.2025-09-07T16-13-09Z（127.0.0.1:9000）
        bucket: dsh-mini-test
```

## FRD1 部署（已落地）

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

## 本地接入（SSH 隧道，不暴露公网）

```bash
ssh -N -L 9095:127.0.0.1:9095 frd1   # /v1/* 面
ssh -N -L 9000:127.0.0.1:9000 frd1   # 可选：S3 直探（mn01/s3-probe）

# .local.development.json → cloud.durable_url = http://127.0.0.1:9095
node scripts/fx-dev-config.mjs
```

DevTools 侧 `project.config.json` 已是 `urlCheck:false`，模拟器可直接访问 `127.0.0.1:9095`。
`test/mn02/ide-durable.mjs` 在 `DURABLE=127.0.0.1` 时自动 patch `wx.cloud`/SOTER：
challenge/SOTER 走 mock，unlock 走网关 `/dev/ticket` 铸真票——**控制面 mock，数据面真**。

## 测试入口

```bash
# Node 真端点（TICKET 用 /dev/ticket 铸）
BASE=http://127.0.0.1:9095 TICKET=... node test/mn02/mp-remote.mjs
BASE=http://127.0.0.1:9095 TICKET=... node test/mn02/edge-matrix.mjs
BASE=http://127.0.0.1:9095 TICKET=... node test/mn02/cold-state.mjs
BASE=http://127.0.0.1:9095 TICKET=... TICKET2=... node test/mn02/public-surface.mjs
BASE=http://127.0.0.1:9095 TICKET=... node test/mn02/tool-observability.mjs

# MinIO 原生 S3 条件写探针（T10）
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=dsh-mini-test \
S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... node test/mn01/s3-probe.mjs

# DevTools 真 App（AUTO_PORT 复用已开自动化会话）
DURABLE=http://127.0.0.1:9095 TICKET_SECRET=... ADMIN_TOKEN=... TEST_OID=mn02-ide-oid \
PATCH_UNLOCK=1 AUTO_PORT=9602 node test/mn02/ide-durable.mjs
```

## 实测语义（2026-11-07）

- MinIO 条件写：`If-Match` / `If-None-Match:*` 均生效；并发同 etag 两写 → `200,412`（`s3-probe` 9/9）。
- worker 五端点（state/claim/alarm）经 MinIO 全绿：`cold-state` 10/10、`public-surface` 39/39。
- VFS 车道全绿：`mp-remote` 27/27、`tool-observability` 21/21。
- DevTools 真 App → 网关 → MinIO：`ide-durable` **6 PASS + 3 NOTE**（D/E 控制面 mock 记 NOTE；NOTE 单列、不计 PASS）。不写全绿分母。真机车道另跑。

## 已知限制

- `PUBLIC_BASE` 是 `http://127.0.0.1:9095`；`vision-dual` 的 `https:` 视觉 URL 分支会被 magpie 拒绝
  （本地 HTTP 不可被上游抓取），`data:` 分支正常。要跑该分支需给网关一个上游可达的 HTTPS 域。
- 网关不跑 30s sweeper；alarm 真链用 `scripts/local-sweeper.mjs`（已实测 claim+consume）。
- 测试数据按 `dsh-mini/{kind}/{oid}/` 隔离；teardown 用 `mc rm --recursive --force` 删前缀。
- 生产合同变更不走本目录；本目录仅测试基础设施。
