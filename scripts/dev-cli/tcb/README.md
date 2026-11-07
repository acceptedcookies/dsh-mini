# dev-cli · CloudBase tcb 通道

> 真源：https://cloudbase.net/skill.md（CloudBase Setup Skill）。
> 本目录是 `scripts/dev-cli/tcb.mjs` 的命令元数据与说明；不建 MCP/automator 桥，只 spawn `tcb`。

## 文件结构

```text
scripts/dev-cli/
├── tcb.mjs                 # 唯一注册入口（index.mjs tcb ...）
├── lib/tcb.mjs             # 核心：tcbRun/tcbJson/status/fn/trigger/domain/doctor
└── tcb/
    ├── commands.mjs        # 域命令 + fn 子命令元数据（skill 对照）
    └── README.md           # 本文件
```

## 命令面

```bash
node scripts/dev-cli/index.mjs tcb status --json
node scripts/dev-cli/index.mjs tcb doctor --json --env <envId> --function <name>
node scripts/dev-cli/index.mjs tcb env list
node scripts/dev-cli/index.mjs tcb fn list --env <envId>
node scripts/dev-cli/index.mjs tcb fn detail <name> --env <envId>
node scripts/dev-cli/index.mjs tcb fn deploy <name> --cwd <cloudbaserc-dir> --runtime Nodejs20.19
node scripts/dev-cli/index.mjs tcb fn invoke <name> --env <envId> --data '{"k":"v"}'
node scripts/dev-cli/index.mjs tcb fn trigger-create <name> --cron "0/30 * * * * * *"
node scripts/dev-cli/index.mjs tcb fn trigger-delete <name>
node scripts/dev-cli/index.mjs tcb live-b
node scripts/dev-cli/index.mjs tcb deploy-sweeper-test
```

域命令（`db`/`hosting`/`storage`/`cloudrun`/`logs`/`docs`/`api`/`secrets`/`config`/`app`/`user`/`policy`/`role`/`cors`/`routes`/`domains`/`sandbox`/`ai`/`lowcode`/`validate`/`sync-model-dts`）原样透传到 `tcb <domain> ...`。

## 约束（来自 skill + 本仓）

1. **禁止顶层 `tcb deploy`**：用 `fn deploy` / `hosting deploy` 等领域命令。
2. **首次创建函数才生效 `--runtime`**：`tcb fn deploy <name> --runtime Nodejs20.19`；已有函数改运行时需控制台或重建。
3. **`cloudbaserc.json` 承载 env/timeout**：`tcb fn deploy` 会读 `envId`/`functions[].timeout/envVariables`；`--paths` 方式不应用新函数 env（实测），所以本仓用 `--cwd <cloudbaserc-dir>`。
4. **env/code 脱敏**：`tcb fn detail` 原生命令会明文打印 env/code；`lib/tcb.mjs` 的 `tcbFnDetail` 只回元数据 + env key。不要用原生 `tcb fn detail` 看 env。
5. **secret 不落仓库**：`TICKET_SECRET` 只从 `.anote/frd1/gateway.env` 或进程 env 读取；`cloudbaserc.json` 生成在临时目录（600），不提交。
6. **Live-B 的 `sweeper-test`**：源码/部署步骤在 `test/simulation/sim-wx-alarm/sweeper-test/`；`tcb deploy-sweeper-test` 会生成临时 cloudbaserc 并部署。
