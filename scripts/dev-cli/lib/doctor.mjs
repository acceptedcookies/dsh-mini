/** dev-cli · 健康检查（AI 增强形态的 doctor）。
 *
 *  检查面：DevTools 安装/版本、CLI、skill 包、MCP Token、项目配置、
 *  本地 registry、skill 目录、automator 端口；--probe 追加 MCP 握手与
 *  skill 状态（登录态/版本关系/token 要求）。
 *
 *  输出：{ schema, ok, checks[], summary, channels, meta }
 *  level: error（失败）/ warn（降级）/ info（事实）。
 */
import { existsSync } from 'node:fs'
import { devtoolsInfo, skillInfo, tokenInfo, projectInfo, wechatideInfo, CLI_PATH, SKILL_DIR } from './devtools.mjs'
import { channelStatus, SkillChannel } from './channels.mjs'
import { McpClient } from './mcp.mjs'
import { loadSkillCatalog, loadMcpCatalog, mergeCatalogs, summarizeCatalog } from './catalog.mjs'
import { assertRegistry } from './registry.mjs'
import { REPORT_SCHEMA } from './report.mjs'

export const DOCTOR_SCHEMA = 'dsh-mini.devcli.doctor.v1'

function check(checks, id, ok, level, detail, fix) {
  checks.push({ id, ok: Boolean(ok), level, detail, ...(!ok && fix !== undefined ? { fix } : {}) })
}

export async function doctor({ offline = false, probe = false, automatorPort } = {}) {
  const checks = []
  const meta = { offline, probe, ts: new Date().toISOString() }

  // 1. 安装面（纯文件，不触 IDE）
  const dev = devtoolsInfo()
  check(checks, 'devtools.app', dev.installed, 'error', dev.installed ? `${dev.version} (${dev.source})` : `未找到 ${dev.app}`, '安装微信开发者工具 Stable')
  check(checks, 'devtools.cli', existsSync(CLI_PATH), 'error', CLI_PATH, '确认 DevTools 安装完整（Contents/MacOS/cli）')
  const wxide = wechatideInfo()
  check(checks, 'devtools.wechatide', wxide.available, 'error', wxide.path || `${wxide.bin} 不在 PATH`, '确认 wechatide skill-cli 已安装/软链（WXIDE_BIN 可覆写）')
  const skill = skillInfo()
  check(checks, 'devtools.skill', skill.installed, 'warn', skill.installed ? `${skill.version} (${skill.source})` : `未找到 ${SKILL_DIR}`, '从 DevTools 设置 → 安全复制 MCP 配置；skill 随安装包提供')
  check(checks, 'devtools.skill.version', skill.version !== '', 'warn', skill.version || 'missing', '升级 DevTools 或同步 wechatide-skill')
  const tokens = tokenInfo()
  check(checks, 'devtools.mcp.token', tokens.mcp.present, 'error', `source=${tokens.mcp.source}`, '设置 WXIDE_MCP_TOKEN 或从 DevTools 设置 → 安全复制 MCP 配置')
  check(checks, 'devtools.cli.token', true, 'info', tokens.cli.present ? `source=${tokens.cli.source}` : 'source=none (optional)', '可选：设置 WXIDE_CLI_TOKEN（skill-cli 未启用令牌时不需要）')

  // 2. 项目面
  const project = projectInfo()
  check(checks, 'project.appid', project.appid !== '', 'warn', project.appid || 'missing', 'project.config.json 缺 appid')
  check(checks, 'project.route', project.route !== '', 'info', project.route || 'missing', 'app.json dsh.localRuntimeRoute / dev-config route')
  check(checks, 'project.durable', project.durableUrl !== '', 'info', project.durableUrl || 'missing', 'dev-config cloud.durableUrl')

  // 3. 本地 registry
  const reg = assertRegistry()
  check(checks, 'registry', reg.ok, 'error', `${reg.total} commands`, `缺失脚本: ${reg.missingScripts.join(',') || '无'}；未注册: ${reg.unregistered.join(',') || '无'}`)

  // 4. skill 目录（纯文件）
  const skillCatalog = loadSkillCatalog()
  check(checks, 'catalog.skill', skillCatalog.length > 0, 'warn', `${skillCatalog.length} tools`, 'wechatide-skill tools.yaml 不可读')

  // 5. automator 端口（offline 不触 IDE）
  const channels = await channelStatus({ automatorPort, probeAutomator: !offline })
  if (offline) {
    check(checks, 'automator.port', false, 'info', `skipped (offline) port=${channels.automator.port}`, '去掉 --offline 可探活')
  } else {
    check(checks, 'automator.port', channels.automator.available, 'warn', `ws://127.0.0.1:${channels.automator.port}`, 'DevTools → 设置 → 安全 → 服务端口；或 cli auto 拉起')
  }

  // 6. 在线面（--probe / 非 offline）
  if (!offline) {
    if (skill.installed) {
      try {
        const sc = await SkillChannel.open({ quiet: true })
        const st = await sc.status()
        const loginExpired = st?.loginExpired === true
        check(checks, 'skill.login', !loginExpired, 'error', loginExpired ? 'loginExpired=true' : `user=${st?.loginUser?.nickName ?? '?'}`, '在 DevTools 扫码登录')
        const rel = st?.versionRelation ?? 'skip_check'
        check(checks, 'skill.versionRelation', rel === 'equal' || rel === 'agent_ahead', 'warn', rel, '同步 wechatide-skill 到 agent 侧（agent_behind 时整目录覆盖）')
        check(checks, 'skill.mcpTokenRequired', st?.mcpTokenRequired === true, 'info', String(st?.mcpTokenRequired), 'MCP 入口始终需要独立 Token')
        check(checks, 'skill.cliTokenRequired', st?.cliTokenRequired === true, 'info', String(st?.cliTokenRequired), '可选 CLI 令牌')
        sc.close()
      } catch (e) {
        check(checks, 'skill.status', false, 'warn', e.message, '检查 wechatide skill-cli 是否可用')
      }
    }
    if (probe && tokens.mcp.present) {
      let mcp
      try {
        mcp = await McpClient.open({ quiet: true })
        const mcpCat = await loadMcpCatalog(mcp)
        const merged = mergeCatalogs(mcpCat, skillCatalog)
        const sum = summarizeCatalog(merged)
        check(checks, 'mcp.handshake', true, 'info', `${mcp.serverInfo?.name ?? 'mcp-server'} ${mcp.serverInfo?.version ?? ''}`, undefined)
        check(checks, 'mcp.tools', mcpCat.length > 0, 'error', `${mcpCat.length} tools (merged ${sum.total})`, 'MCP tools/list 为空——检查 DevTools 版本/授权')
        if (skillCatalog.length > 0 && mcpCat.length !== skillCatalog.length) {
          check(checks, 'mcp.skill.parity', false, 'warn', `mcp=${mcpCat.length} skill=${skillCatalog.length}`, 'MCP 与 skill 工具面不一致——跑 catalog.mjs --diff 并同步')
        } else {
          check(checks, 'mcp.skill.parity', true, 'info', `mcp=${mcpCat.length} skill=${skillCatalog.length}`, undefined)
        }
      } catch (e) {
        check(checks, 'mcp.handshake', false, 'warn', e.message, '检查 MCP Token / IDE 授权弹窗')
      } finally {
        mcp?.close()
      }
    }
  }

  const errors = checks.filter((c) => !c.ok && c.level === 'error')
  const warns = checks.filter((c) => !c.ok && c.level === 'warn')
  const infos = checks.filter((c) => !c.ok && c.level === 'info')
  return {
    schema: DOCTOR_SCHEMA,
    reportSchema: REPORT_SCHEMA,
    ok: errors.length === 0,
    checks,
    summary: {
      total: checks.length,
      pass: checks.filter((c) => c.ok).length,
      warn: warns.length,
      error: errors.length,
      info: infos.length,
    },
    channels,
    meta,
  }
}
