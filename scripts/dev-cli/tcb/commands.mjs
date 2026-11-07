/** dev-cli · tcb 通道命令面（与 CloudBase Skill 的域命令一一对应）。
 *
 *  真源：https://cloudbase.net/skill.md
 *  只登记域命令，不登记顶层 `tcb deploy`（skill 明确禁用）。
 */
export const TCB_DOMAINS = [
  { name: 'env', summary: '环境列表/切换', readOnly: false, skill: '§2 login/env' },
  { name: 'fn', summary: '云函数 list/detail/deploy/invoke/trigger/env/logs', readOnly: false, skill: '§2 functions' },
  { name: 'db', summary: '云数据库（集合/文档/索引）', readOnly: false, skill: '§2 database' },
  { name: 'hosting', summary: '静态托管部署/管理', readOnly: false, skill: '§2 hosting' },
  { name: 'storage', summary: '云存储对象管理', readOnly: false, skill: '§2 storage' },
  { name: 'cloudrun', summary: 'CloudBase Run 服务', readOnly: false, skill: '§2 cloudrun' },
  { name: 'logs', summary: '云函数/服务日志检索', readOnly: true, skill: '§2 logs' },
  { name: 'docs', summary: 'CloudBase 文档检索', readOnly: true, skill: '§2 docs' },
  { name: 'api', summary: '通用腾讯云 API 调用', readOnly: false, skill: '§2 api' },
  { name: 'secrets', summary: '临时凭证管理', readOnly: false, skill: '§2 secrets' },
  { name: 'config', summary: 'CLI 配置（isIntl/region 等）', readOnly: false, skill: '§Which site' },
  { name: 'app', summary: 'CloudBase App 部署/信息/版本', readOnly: false, skill: '§2 app' },
  { name: 'user', summary: '用户管理', readOnly: false, skill: '§2 user' },
  { name: 'policy', summary: '网关授权策略（OPA Rego）', readOnly: false, skill: '§2 policy' },
  { name: 'role', summary: '角色管理', readOnly: false, skill: '§2 role' },
  { name: 'cors', summary: '安全域名/CORS', readOnly: false, skill: '§2 cors' },
  { name: 'routes', summary: 'HTTP 访问路由', readOnly: false, skill: '§2 routes' },
  { name: 'domains', summary: '自定义域名', readOnly: false, skill: '§2 domains' },
  { name: 'sandbox', summary: 'Sandbox 工具/实例', readOnly: false, skill: '§2 sandbox' },
  { name: 'ai', summary: 'AI 全栈开发体验', readOnly: false, skill: '§2 ai' },
  { name: 'lowcode', summary: 'WeDa 低代码', readOnly: false, skill: '§2 lowcode' },
  { name: 'validate', summary: '校验项目是否符合 CloudBase 应用规范', readOnly: true, skill: '§2 validate' },
  { name: 'sync-model-dts', summary: '同步数据模型类型定义', readOnly: false, skill: '§2 sync-model-dts' },
]

export const TCB_FN_SUBCOMMANDS = [
  { name: 'list', summary: '列出云函数', readOnly: true },
  { name: 'detail', summary: '函数元数据（env/code 脱敏）', readOnly: true },
  { name: 'deploy', summary: '部署（首次创建；--runtime 仅首次生效）', readOnly: false },
  { name: 'invoke', summary: '调用云函数', readOnly: false },
  { name: 'trigger-create', summary: '创建 timer trigger', readOnly: false },
  { name: 'trigger-delete', summary: '删除 timer trigger', readOnly: false },
  { name: 'logs', summary: '检索函数日志（tcb logs search）', readOnly: true },
  { name: 'env-pull', summary: '拉取函数 env 到本地文件', readOnly: true },
]

export const TCB_BLOCKED = ['deploy']

export function tcbDomain(name) {
  return TCB_DOMAINS.find((d) => d.name === name)
}
