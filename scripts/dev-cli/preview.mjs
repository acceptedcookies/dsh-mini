// dev-cli · 真机预览：auto_preview → pending/taskId → polling_task_result。
// 用法: node scripts/dev-cli/preview.mjs [--timeout 90000] [--interval 4000] [--via mcp|skill] [--json]
// 契约：IDE 侧弹预览授权框需手动批准；脚本轮询任务结果直到终态。
//       不要重发 auto_preview——先查旧 taskId（skill 包 async-task-polling.md 同口径）。
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf, boolFlag, numberFlag } from './lib/args.mjs'
import { runMain } from './lib/report.mjs'

const { flags } = parseArgs()
const timeoutMs = numberFlag(flags, 'timeout', 90000)
const intervalMs = numberFlag(flags, 'interval', 4000)
const via = flagOf(flags, 'via', undefined)
const json = boolFlag(flags, 'json')

await runMain('preview', async () => {
  const d = await ProbeDriver.open({ via })
  try {
    const r = await d.call('auto_preview', {}, { timeoutMs: 30000 })
    const task = await d.awaitTask(r, {
      timeoutMs, intervalMs,
      onTick: (text) => { if (!json) console.error(`[preview] ${text.slice(0, 200)}`) },
    })
    return { taskId: task.taskId, status: task.status, text: task.text }
  } finally {
    await d.close()
  }
}, { json })
