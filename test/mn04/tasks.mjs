// L1（Node）：tasks 异步任务纯函数——不开 IDE。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { extractTaskId, isPending, pollTask, awaitTask } = await import(`${ROOT}/scripts/dev-cli/lib/tasks.mjs`)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

check('extractTaskId：直接 taskId', extractTaskId({ pending: true, taskId: 't-1' }) === 't-1')
check('extractTaskId：嵌套 content text', extractTaskId({ result: { content: [{ text: '{"taskId":"task-abc123"}' }] } }) === 'task-abc123')
check('extractTaskId：无 taskId → undefined', extractTaskId({ result: { success: true } }) === undefined)
check('isPending：pending+taskId', isPending({ pending: true, taskId: 't-1' }) === true)
check('isPending：status=pending', isPending({ status: 'pending' }) === true)
check('isPending：同步成功', isPending({ success: true }) === false)

// pollTask：fake driver 第 2 次返回 success
{
  let n = 0
  const driver = { call: async () => { n++; return { result: { status: n >= 2 ? 'success' : 'pending' } } } }
  const r = await pollTask(driver, 't-3', { timeoutMs: 10000, intervalMs: 10 })
  check('pollTask：轮询到终态', r.status === 'terminal' && n >= 2, `n=${n}`)
}

// awaitTask：无 taskId → sync
{
  const r = await awaitTask({ call: async () => ({}) }, { success: true })
  check('awaitTask：无 taskId → sync', r.status === 'sync' && r.taskId === null)
}

// awaitTask：有 taskId → 轮询
{
  const driver = { call: async () => ({ result: { status: 'success' } }) }
  const r = await awaitTask(driver, { pending: true, taskId: 't-4' }, { timeoutMs: 10000, intervalMs: 10 })
  check('awaitTask：有 taskId → terminal', r.status === 'terminal' && r.taskId === 't-4')
}

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
