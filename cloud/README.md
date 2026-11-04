# cloud/ —— BYOK 微信云端（控制面 + 数据面 + 本地模拟）

拓扑设计见 `rules/topology-local.md`（草案，凭证面变更待业主裁决）。本目录只放云侧产物；小程序端接线在 `services/fx/`。

## 结构

```
cloud/
  lib/                  canonical 共享规格（部署单元各自携带同步副本，勿跨目录引用部署）
    envelope.cjs        信封加密: DEK=HKDF(master,recordId) + AES-256-GCM + AAD(openid|provider|recordId)
    ticket.cjs          HS256 短 TTL 能力票据 sign/verify
  functions/            控制面（wx-server-sdk，wx.cloud.callFunction 调用）
    enroll/             {provider,base_url,api_key,model,challenge,result_json,result_signature}
                        → challenge 核销 + SOTER 验签（无 bio 禁注入·服务端强制）→ 信封加密 → byok_keys 记录
    unlock/             action=challenge 下发一次性挑战；action=unlock SOTER 验签 → 签发票据
    revoke/             action=ticket 黑名单 jti；action=key 删记录
  proxy/                数据面（CloudBase Run 容器，对外 https）
    server.mjs          /v1/* → 验票据 → 取记录 → 内存解密 → 转发上游 → SSE 流回
                        body.model 白名单闸（ALLOWED_MODELS env）
    Dockerfile          node:22-alpine
  sim/
    server.mjs          本地模拟：同构控制面+数据面（openid 固定 sim_dev_user）
                        bio 同构：GET /sim/bio 能力查询、POST /sim/bio 签发 HMAC 证明、
                        enroll/unlock 均验签（对齐真云语义，差异仅证明签发方为 sim 自签非 TEE）
                        dev 专用：POST /sim/_bio 门禁开关、POST /sim/_reset 清库、GET /sim/status
                        node cloud/sim/server.mjs → 127.0.0.1:3426
```

## 云资源准备（业主决策项）

1. 小程序管理后台开通**云开发**（env_id 记入 `.local.development.json` 的 `cloud.env_id`）。
2. 云数据库建集合：`byok_keys`、`byok_challenges`、`byok_revoked`，安全规则按 openid 隔离（仅创建者可读写自己的记录）。
3. 部署云函数 `functions/{enroll,unlock,revoke}`（各目录 `npm i` 后上传），env 配 `MASTER_KEY`、`TICKET_SECRET`（强随机，永不下发）、`ALLOWED_MODELS`（逗号分隔，当前 `workbuddy/deepseek-v4.1-flash,workbuddy/deepseek-v4-pro`）。
4. `proxy/` 部署到**云托管**：构建镜像 → env 配 `MASTER_KEY`/`TICKET_SECRET`/`TCB_ENV`/`ALLOWED_MODELS` → 对外 https 地址记入 `.local.development.json` 的 `cloud.proxy_url`。
5. `node scripts/fx-dev-config.mjs` 重新生成 `dev-config.ts`，`app.json` 旋钮切 `cloud`。

## 与 sim 的差异边界

sim 用固定 openid `sim_dev_user` + dev 常量密钥；bio 证明为 sim 自签 HMAC（真云=TEE soter.verifySignature）。**门禁语义已同构**：enroll/unlock 均强制验签，sim bio 关闭时注入与解锁同拒（对齐「无 bio 禁止 apikey 注入」业主裁决）。sim 验证的是：**协议形态、信封/票据规格、bio 门禁流程、模型白名单闸、代理转发与 SSE 承载、客户端接线** —— 不验证微信 openid 认证与真实 TEE 签名本身（真云 + 真机 R 车道）。

## 同步纪律

`lib/*.cjs` 是 canonical；`proxy/lib/`、`functions/*/index.js` 内嵌实现是部署副本。改规格必须先改 `lib/` 再同步副本，并在 README 记一笔。
