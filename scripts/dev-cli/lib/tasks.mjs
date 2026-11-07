/** dev-cli · DevTools 异步任务（AI 增强形态的 pending/taskId 语义）。
 *
 *  升级后的工具面统一约定：需要用户授权/扫码/确认的 toolCall 返回
 *  `{ pending: true, taskId }`；调用方用 `polling_task_result` 查终态。
 *  本模块把「提取 taskId → 轮询 → 终态判定」收成单一实现，preview/task/
 *  session/agent 共用，禁止各自手写轮询循环。
 */

export const TASK_SCHEMA = 'dsh-mini.devcli.task.v1'
export const DEFAULT_TIMEOUT_MS = 90_000
export const DEFAULT_INTERVAL_MS = 4_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function walk(value, visit, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return
  visit(value)
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) walk(v, visit, depth + 1)
  }
}

const TASK_RE = /task[_\s-]?id\\?["']?\s*[:=]\s*\\?["']?([\w-]{6,})/i

/** 任意工具返回体 → taskId（无则 undefined）。 */
export function extractTaskId(value) {
  let found
  const strings = []
  walk(value, (v) => {
    if (found !== undefined) return
    if (typeof v === 'string') { strings.push(v); return }
    if (v === null || typeof v !== 'object') return
    for (const k of ['taskId', 'task_id', 'taskID']) {
      if (typeof v[k] === 'string' && v[k].length > 0) { found = v[k]; return }
    }
  })
  if (found !== undefined) return found
  // 先扫每个字符串（content[].text 里的 JSON 片段），再扫整体 JSON（转义引号容错）
  for (const s of strings) {
    const m = TASK_RE.exec(s)
    if (m !== null) return m[1]
  }
  const text = typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) } catch { return '' } })()
  return TASK_RE.exec(text)?.[1]
}

/** 返回体是否处于 pending（需要用户授权/扫码/确认）。 */
export function isPending(value) {
  let pending = false
  walk(value, (v) => {
    if (pending || v === null || typeof v !== 'object') return
    if (v.pending === true) pending = true
    if (typeof v.status === 'string' && /pending|waiting|authoriz|confirm/i.test(v.status)) pending = true
  })
  return pending || extractTaskId(value) !== undefined
}

function terminal(status) {
  return /success|succeed|ok|完成|成功|fail|error|失败|cancel|timeout/i.test(status)
}

/** 轮询单个 taskId 到终态。onTick(statusText) 供 CLI 实时打印。 */
export async function pollTask(driver, taskId, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  onTick,
} = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const r = await driver.call('polling_task_result', { taskId }, { timeoutMs: 15000 })
    const text = typeof r === 'string' ? r : JSON.stringify(r?.result ?? r)
    last = r
    onTick?.(text)
    if (terminal(text)) return { schema: TASK_SCHEMA, taskId, status: 'terminal', text, raw: r }
  }
  return { schema: TASK_SCHEMA, taskId, status: 'timeout', text: last === null ? '' : JSON.stringify(last), raw: last }
}

/** 工具返回体 → 自动提取 taskId 并轮询；无 taskId 视为同步完成。 */
export async function awaitTask(driver, response, opts = {}) {
  const taskId = extractTaskId(response)
  if (taskId === undefined) {
    return { schema: TASK_SCHEMA, taskId: null, status: 'sync', text: '', raw: response }
  }
  return pollTask(driver, taskId, opts)
}
