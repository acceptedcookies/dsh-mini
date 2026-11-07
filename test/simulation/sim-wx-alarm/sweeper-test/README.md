# sweeper-test（sim-wx-alarm Live-B 专用）

> 不是生产 sweeper；只在 `https://dsh-mini-test.saobao.com` 的 test bucket 上跑 alarm → `sim_echo` → scripted final。
> 生产 sweeper 仍在 `cloud/functions/sweeper`，不要混用。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | `sweeper-test` 主体：真实 kernel + host `sweepTick`；`sim_echo` 工具写 `state/sim-tool-count-{sid}`；`SIM_WX_ALARM_TEST=1` 时 `ioLlm` 返回 scripted `sim-final`，不调生产 proxy |
| `package.json` | `wx-server-sdk` 依赖声明 |
| `cloudbaserc.template.json` | tcb 部署模板；`TICKET_SECRET` 是占位符，真实值由 `deploy.mjs` 从 `.anote/frd1/gateway.env` 注入 |
| `deploy.mjs` | 生成临时 build/project 目录 → `tcb fn deploy` → 创建 30s timer；不打印 secret |

## 部署

```bash
# 30s timer + 部署（Live-B 默认）
node test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs

# 只部署、不建 timer（手动 tcb fn invoke 用）
node test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs --no-trigger

# 保留临时目录排查（含 secret，别提交/别外传）
node test/simulation/sim-wx-alarm/sweeper-test/deploy.mjs --keep
```

前置：本机 `tcb` CLI 已登录；`cloud/functions/sweeper/vendor/{kernel,host}.cjs` 已构建；`cloud/functions/sweeper/node_modules` 存在。

## 运行 / 清理

```bash
node scripts/dev-cli/index.mjs tcb live-b
node scripts/dev-cli/index.mjs tcb fn trigger-delete sweeper-test
node scripts/dev-cli/index.mjs tcb fn detail sweeper-test   # dev-cli 版：env 只报 key
```

- `tcb fn detail` 原生命令会明文打印 env/code；不要直接用它看 env。
- 测试只写 test bucket（`dsh-mini-test`），不写生产桶；Live-B 使用真实 oid，但行都在 test bucket。
- `sim_echo` 的计数 key 是 `state/sim-tool-count-{sid}`；Live-B 脚本断言 `count=1`。
