# test/spike/mini-skin — MS01 skin 真源/投影/投递能力取证

> **一句话定义**：在 `MS01`（token→skin 联邦真源 + 单管线投影 + 单通道投递）落地前/中/后，用可复跑的静态 + DevTools 模拟器实测，回答「`@media` dark 全键兜底是否激活、`var()` 二级引用是否成立、surfaces `url()` 值域是否可保留、五产物是否与迁移前有效值等价」四个设计前提。**spike 只产事实，不产合同。**

## 锚表

| 项 | 值 |
|---|---|
| 建档日期 | 2026-11-08 |
| 基线 HEAD | `b63057f8fdd1bd31112ef451edda6511b310aabc`（P0 落地前，含 `@import (inline)` 探针态） |
| 上游真相 | `docs/truth/mini-skin/MS01-qna.md`（frozen：`T-O-B1~B8` / `T-O-1~11` / `MS01-E1~E9`） |
| 执行计划 | `docs/plan/mini-skin/MS01-skin-truth-projection.md`（§8 测试台账） |
| 环境 | `H1` 本机 macOS Node 22（静态/纯函数）；`S1` DevTools 2.02.2609250 模拟器（MCP 通道） |
| 证据上限 | `S1` PASS 不外推真机；`automator 9420` 不可用（doctor --probe 实测），视觉链走 MCP |
| 组织先例 | `test/spike/fx-wasm-*` / `test/spike/nano-tools` 的宪章制工作区（纪律同源） |

## 边界声明

- 不改产品代码、不改冻结真相；探针脚本只落本目录与 `scripts/dev-cli/skin-visual.mjs`（工具面）。
- 不注册 npm script、不进 CI、不作为 release gate；`test/spike/README.md` §2.4/§2.8 纪律全适用。
- 不覆盖真机（R1/R2）——真机 `setData` 全量串只登记为 T17 证据项，交 MS03。
- 不覆盖 import 端到端（`chooseMessageFile`/`downloadFile`）——`T-O-5` 划出。

## 价值台账

| 行 | 价值 | 状态 |
|---|---|---|
| `T06` | `skin.gen` 静态兜底在模拟器编译生效（`@import (inline)` 形态 + plant） | P2 实证 |
| `T11` | 20 调用点迁移后三档切换 / chrome / 全局重算 | P4 实证 |
| `T13` | resolution-diff 主判据（P0 基线 vs P6 resolved） | P0 基线、P6 对照 |
| `T15` | 视觉场景图抽样（旧六场景 + models×2 + 浮面×3） vs 基线 | P0 基线、P6 比对 |
| `T17` | 三首验项：`@media` dark 激活 / `var()` 二级引用 / `surfaces url()` PROVISIONAL | P0 preflight、P6 实证 |
| `T18` | fixture 双模式皮肤 `applySkin` + resolved 快照 | P6 实证 |

## 判读门槛（执行前写死，跑完不挪）

1. **T06 PASS** = `refresh` 编译成功，且 `eval` 读回 `.app` computed `background-color` 为 `rgb(255, 255, 255)`（light 下 `--dsw-alias-bg-base`）；plant = 摘除 `app.less:1` `@import` 行后同一断言变红（回落到无变量态）、复原后变绿。缺 plant 记 `RED`。
2. **T11 PASS** = settings 三档 `onThemeMode` 后 `storage['dsh:theme:v2']` 与页面 `theme` data 同步；models/workspace `applyChrome` 读回 `backgroundColor` 分别为 `#ffffff`/`#151517`（对应 surface）；系统模式切换触发 resolved 重算（`--dsw-alias-bg-base` computed 值变化）。
3. **T17-@media**：`scene.mjs dark` 用户路径下 `page` 无 computedStyle 查询能力（E6），改用 `eval` 读 `wx.getSystemInfoSync().theme === 'dark'` + `skin.gen.wxss` 内 `@media` 规则文本存在 + 真机/模拟器视觉底 `rgb(21, 21, 23)`；`--sysinfo` 媒体 mock 只作旁证。`RED` → 按 `T-O-2` 回退 `@media` 仅 bg，不废架构。
4. **T17-var()**：随机抽 5–10 个改指消费点，`getComputedStyle` 读回值 = 期望 `rgb/rgba` 值（非空、非 `var(...)` 字面量）。
5. **T17-url()**：`surfaces` 值域含 `url("https://...")` 的 fixture 在 `validate` 过、运行时 `background-image` computed 含 `url(`；不过则 v1 值域收窄色/渐变并回写 qna defer#3。
6. **T18 PASS** = 两 fixture 过 `validate`；`applySkin` 后 `resolved` 键集 ≡ vocab 键集（数量+键名），写键=skin 值、未写键=defaults，light-only fixture 切 dark 回落 `defaults[dark]`。
7. **T15** 证据项非硬闸：允许字体/动画帧微差；语义差（底色/文字色/边界色可见变化）= `RED`，登记后走 §10.4 回退判定。

## plants 台账（证伪镜像）

| plant ID | 行 | 植入 | 期望 |
|---|---|---|---|
| `P-T06-IMPORT` | T06 | 注释 `app.less:1 @import` 行 | eval 断言变红；复原变绿 |
| `P-T13-TAMPER` | T13 | `skin-equiv-check.mjs --self-test` 篡改基线 `--dsw-alias-bg-base` | diff 非空 |
| `P-T17-URL` | T17 | `surfaces.url` 非法值（`data:`/相对协议）fixture | `validate` 拒绝，`{path,rule}` 命中 L3 |
| `P-T05-CONTRACT` | T05 | 临时 `*.contract.ts` 未收编 | `--check` exit 1；删除后复原 |

## 跑法

```bash
# 静态 / 纯函数（H1）
node test/spike/mini-skin/node-checks.mjs

# P0 基线（一次性；已存在拒绝覆写）
node scripts/skin-equiv-check.mjs --baseline
node scripts/token-audit.mjs --baseline .anote/ms01-baseline/token-audit.json

# 视觉场景图（S1，MCP 通道；绝对路径输出）
node scripts/dev-cli/skin-visual.mjs --out "$(pwd)/.anote/ms01-baseline/shots" --prefix p0-

# P6 对照 / 自证
node scripts/skin-equiv-check.mjs --check --phase p6
node scripts/skin-equiv-check.mjs --self-test
```

## 证据分级

- 终态词：`PASS` / `RED` / `NOT_RUN`（附原因）/ `deferred`（附前置）。
- receipt envelope 字段：`id/lane/verdict/envClass/grade/at/headSha/dirtyWorktree/plants/budget/detail`（`test/spike/README.md` §4）。
- 证据目录：`evidence/<id 小写>/<UTC 时间戳>.json`（`.gitignore` 忽略）。

## 收口回填

> 本文件在 MS01 收口时回填：各 Test-ID verdict、环境、`headSha`、证据路径与残余 RED。

| Test-ID | verdict | 环境 | 证据 |
|---|---|---|---|
| `T06` | `PASS` | S1 | `evidence/t06/*`（plant 摘 import → rgba(0,0,0,0)，复原 rgb(255,255,255)） |
| `T11` | `PASS` | S1 | `evidence/t11/*`（settings 三档 + models/workspace appStyle 5879） |
| `T13` | `PASS` | H1 | `.anote/ms01-p6/equiv-p6.json`（0 errors/0 diffs/12 intended/15 tokenization） |
| `T15` | `PASS` | S1 | `.anote/ms01-p6/visual-diff.json`（12 场景 max 0.044/0.06%） |
| `T17` | `deferred`（media）/`PASS`（var/url） | S1 | `evidence/t17/*`（reason `media-dark-not-triggerable-in-devtools`） |
| `T18` | `PASS` | S1+H1 | `evidence/t18/*`（forest #2f855a/#f7fdf9/149 keys） |
