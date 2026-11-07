// dev-cli · 异步任务轮询（polling_task_result 的统一封装）。
// 用法:
//   node scripts/dev-cli/task.mjs <taskId>
//   node scripts/dev-cli/task.mjs <taskId> --timeout 120000 --interval 4000
//   [--via mcp|skill] [--json]
// 语义: pending/taskId 是 DevTools 的授权/扫码/确认语义——不要重发原写操作，
//       先查旧 taskId（skill 包 async-task-polling.md 同口径）。
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag, numberFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags, positional } = parseArgs()
const taskId = positional[0]
if (!taskId) {
  console.error('用法: task.mjs <taskId> [--timeout ms] [--interval ms] [--via mcp|skill] [--json]')
  process.exit(2)
}
const json = boolFlag(flags, 'json')
const via = flagOf(flags, 'via', undefined)
const timeoutMs = numberFlag(flags, 'timeout', 90000)
const intervalMs = numberFlag(flags, 'interval', 4000)

await runMain('task', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    return await d.task(taskId, {
      timeoutMs, intervalMs,
      onTick: (text) => { if (!json) console.error(`[task] ${text.slice(0, 200)}`) },
    })
  } finally {
    await d.close()
  }
}, { json })
