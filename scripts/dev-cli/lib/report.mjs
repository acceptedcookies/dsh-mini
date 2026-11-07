/** dev-cli · 机器可读输出信封（AI 增强形态的稳定契约）。
 *
 *  所有新工具（doctor/catalog/testaccount/task/agent/skill/index）统一输出：
 *    { schema, command, ok, ts, data?, warnings[], error?, meta? }
 *  `--json` 时纯 JSON；否则人类摘要 + JSON 数据。旧工具保持原输出不变。
 */
import { classifyError } from './pitfalls.mjs'

export const REPORT_SCHEMA = 'dsh-mini.devcli.v1'

export function makeReport({ command, ok = true, data, warnings = [], error, meta } = {}) {
  return {
    schema: REPORT_SCHEMA,
    command,
    ok,
    ts: new Date().toISOString(),
    ...(data !== undefined ? { data } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(meta !== undefined ? { meta } : {}),
  }
}

export function errorInfo(err) {
  const e = err instanceof Error ? err : new Error(String(err))
  const c = classifyError(e)
  return {
    message: e.message,
    kind: c.kind,
    ...(c.pitfall?.id !== undefined ? { pitfall: c.pitfall.id } : {}),
    ...(e.code !== undefined ? { code: e.code } : {}),
  }
}

export function emit(report, { json = false, quiet = false } = {}) {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  if (quiet) return
  const head = `[${report.command}] ${report.ok ? 'ok' : 'FAIL'}`
  console.log(head)
  if (report.warnings?.length) {
    for (const w of report.warnings) console.log(`  warn: ${w}`)
  }
  if (report.data !== undefined) console.log(JSON.stringify(report.data, null, 2))
  if (report.error !== undefined) {
    console.log(`  error: ${report.error.message}`)
    if (report.error.pitfall) console.log(`  pitfall: ${report.error.pitfall}`)
  }
}

export function exitCodeFor(report) {
  return report.ok ? 0 : 1
}

/** 工具入口包装：统一 try/catch → report → 输出 → exit。 */
export async function runMain(command, fn, { json = false, quiet = false } = {}) {
  let report
  try {
    const data = await fn()
    report = makeReport({ command, ok: true, data })
  } catch (e) {
    report = makeReport({ command, ok: false, error: errorInfo(e) })
  }
  emit(report, { json, quiet })
  const code = exitCodeFor(report)
  process.exitCode = code
  // 子进程 stdio 句柄可能让事件循环滞留（MCP 桥尤其）——给 stdout 冲刷窗口后强制收口。
  setTimeout(() => process.exit(code), 100).unref()
  return report
}
