/** dev-cli · CloudBase (tcb) 高级通道核心。
 *
 *  真源：https://cloudbase.net/skill.md（CloudBase Setup Skill）。
 *  本文件只封装 tcb CLI：登录态/环境/云函数/DB/hosting/storage/cloudrun/logs 等域命令。
 *  约束：
 *    - 不调用顶层 `tcb deploy`（skill 明确要求用领域命令：fn deploy / hosting deploy / …）；
 *    - `fn detail` 的 env/code 默认脱敏，只报 key/字段，不打印 secret；
 *    - 任何 secret 只从 env/本地 600 文件读取，不写入仓库。
 */
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from './args.mjs'

export const TCB_SCHEMA = 'dsh-mini.devcli.tcb.v1'
export const TCB_BIN = process.env.TCB_BIN ?? 'tcb'

export function tcbRun(args, { cwd = REPO_ROOT, timeoutMs = 180_000, env } = {}) {
  const r = spawnSync(TCB_BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(env ?? {}) },
  })
  const timedOut = r.error?.code === 'ETIMEDOUT'
  if (r.error !== undefined && !timedOut) throw new Error(`tcb 启动失败: ${r.error.message}`)
  return { args, code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut }
}

export function parseTcbJson(stdout) {
  const text = String(stdout ?? '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error(`tcb 输出不是 JSON: ${text.slice(0, 200)}`)
  return JSON.parse(text.slice(start, end + 1))
}

export function tcbJson(args, opts = {}) {
  const r = tcbRun([...args, '--json'], opts)
  if (r.code !== 0) throw new Error(`tcb ${args.join(' ')} exit=${r.code}${r.timedOut ? ' (timeout)' : ''}\n${r.stderr.slice(-800)}`)
  return parseTcbJson(r.stdout)
}

export function tcbVersion() {
  const r = tcbRun(['--version'], { timeoutMs: 30_000 })
  const line = `${r.stdout}\n${r.stderr}`.split('\n').map((s) => s.trim()).find((s) => /CloudBase CLI/i.test(s))
  return line ?? (r.stdout || r.stderr).trim().split('\n')[0] ?? ''
}

export function tcbAvailable() {
  try { return tcbVersion().length > 0 } catch { return false }
}

function envIdArgs(envId) {
  return envId !== undefined && envId !== '' ? ['-e', envId] : []
}

export function tcbEnvList(envId) {
  const raw = tcbJson(['env', 'list', ...envIdArgs(envId)])
  const list = Array.isArray(raw?.data) ? raw.data : []
  return list.map((e) => ({
    envId: e.EnvId,
    packageId: e.PackageId,
    status: e.Status,
    payMode: e.PayMode,
    createTime: e.CreateTime,
    expireTime: e.ExpireTime,
  }))
}

export function tcbStatus() {
  const version = tcbVersion()
  const envs = tcbEnvList()
  return {
    schema: TCB_SCHEMA,
    bin: TCB_BIN,
    version,
    envCount: envs.length,
    envs,
  }
}

export function tcbFnList(envId) {
  const raw = tcbJson(['fn', 'list', ...envIdArgs(envId)])
  const list = Array.isArray(raw?.data?.Functions) ? raw.data.Functions : []
  return list.map((f) => ({
    name: f.FunctionName,
    runtime: f.Runtime,
    status: f.Status,
    description: f.Description ?? '',
    addTime: f.AddTime,
    modTime: f.ModTime,
  }))
}

const SECRET_KEY = /secret|token|key|password|passwd|credential/i

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '<redacted>' : redactSecrets(v)
    return out
  }
  return value
}

/** fn detail：只回元数据 + env key 列表；code/env 值默认不输出。 */
export function tcbFnDetail(name, envId) {
  const raw = tcbJson(['fn', 'detail', name, ...envIdArgs(envId)])
  const d = raw?.data ?? raw
  const envVars = d?.Environment?.Variables ?? d?.EnvVariables ?? d?.EnvironmentVariables ?? {}
  const envKeys = Array.isArray(envVars)
    ? envVars.map((v) => v?.Key ?? v?.Name ?? v?.key ?? '').filter(Boolean)
    : Object.keys(envVars ?? {})
  return {
    name: d?.FunctionName ?? name,
    runtime: d?.Runtime ?? null,
    timeout: d?.Timeout ?? null,
    memorySize: d?.MemorySize ?? null,
    status: d?.Status ?? d?.AvailableStatus ?? null,
    handler: d?.Handler ?? null,
    description: d?.Description ?? '',
    triggers: d?.Triggers ?? d?.TriggerConfig ?? null,
    envKeys,
    addTime: d?.AddTime ?? null,
    modTime: d?.ModTime ?? null,
  }
}

export function tcbFnDeploy({ name, cwd, runtime, force = true, installDependency = false }) {
  const args = ['fn', 'deploy', name, '--cwd', cwd]
  if (runtime !== undefined && runtime !== '') args.push('--runtime', runtime)
  args.push('--install-dependency', installDependency ? 'true' : 'false')
  if (force) args.push('--force')
  const r = tcbRun(args, { timeoutMs: 300_000 })
  if (r.code !== 0) throw new Error(`tcb fn deploy ${name} exit=${r.code}${r.timedOut ? ' (timeout)' : ''}\n${r.stderr.slice(-800)}`)
  return { name, code: r.code, stdout: r.stdout.trim(), stderr: r.stderr.trim() }
}

export function tcbFnInvoke(name, data, envId) {
  const args = ['fn', 'invoke', name, ...envIdArgs(envId), '--json']
  if (data !== undefined) args.push('--params', JSON.stringify(data))
  const r = tcbRun(args, { timeoutMs: 180_000 })
  if (r.code !== 0) throw new Error(`tcb fn invoke ${name} exit=${r.code}${r.timedOut ? ' (timeout)' : ''}\n${r.stderr.slice(-800)}`)
  return parseTcbJson(r.stdout)
}

export function tcbTriggerCreate(name, { triggerName = 'tick', cron = '0/30 * * * * * *', envId } = {}) {
  const r = tcbRun(['fn', 'trigger', 'create', name, '--trigger-name', triggerName, '--cron', cron, ...envIdArgs(envId)], { timeoutMs: 60_000 })
  if (r.code !== 0) throw new Error(`tcb fn trigger create ${name} exit=${r.code}\n${r.stderr.slice(-600)}`)
  return { name, triggerName, cron, code: r.code, stdout: r.stdout.trim() }
}

export function tcbTriggerDelete(name, { triggerName = 'tick', envId } = {}) {
  const r = tcbRun(['fn', 'trigger', 'delete', name, triggerName, ...envIdArgs(envId)], { timeoutMs: 60_000 })
  if (r.code !== 0) throw new Error(`tcb fn trigger delete ${name} exit=${r.code}\n${r.stderr.slice(-600)}`)
  return { name, triggerName, code: r.code, stdout: r.stdout.trim() }
}

export function tcbDomain(domain, args = [], { envId, timeoutMs = 180_000 } = {}) {
  if (domain === 'deploy') throw new Error('tcb deploy 被禁用：请用领域命令（fn deploy / hosting deploy / …）')
  const r = tcbRun([domain, ...args, ...envIdArgs(envId)], { timeoutMs })
  return r
}

export function tcbDoctor({ envId, functionName } = {}) {
  const checks = []
  let version = ''
  try { version = tcbVersion() } catch (e) { checks.push({ id: 'tcb:bin', ok: false, detail: e.message }) }
  if (version.length > 0) checks.push({ id: 'tcb:bin', ok: true, detail: version })
  if (version.length > 0) {
    try {
      const envs = tcbEnvList(envId)
      checks.push({ id: 'tcb:env-list', ok: envs.length > 0, detail: `envs=${envs.length}${envId ? ` selected=${envId}` : ''}` })
    } catch (e) {
      checks.push({ id: 'tcb:env-list', ok: false, detail: e.message })
    }
    if (functionName !== undefined && functionName !== '') {
      try {
        const d = tcbFnDetail(functionName, envId)
        checks.push({ id: 'tcb:fn-detail', ok: d.status !== null, detail: `${d.name} runtime=${d.runtime} timeout=${d.timeout} envKeys=${d.envKeys.join(',')}` })
      } catch (e) {
        checks.push({ id: 'tcb:fn-detail', ok: false, detail: e.message })
      }
    }
  }
  return { schema: TCB_SCHEMA, ok: checks.every((c) => c.ok), version, checks }
}
