// dev-cli · 真机预览：auto_preview 任务 + IDE 授权轮询。
// 用法: node scripts/dev-cli/preview.mjs [--timeout 90000]
// 契约：IDE 侧弹预览授权框需手动批准；脚本轮询任务结果直到 success/fail。
import { McpClient, sleep } from './lib/mcp.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const timeout = Number(flagOf(flags, 'timeout', '90000'))

const c = await McpClient.open({ quiet: true })
try {
  const r = await c.call('auto_preview', {}, { timeoutMs: 30000 })
  const text = r?.result?.content?.[0]?.text ?? ''
  const taskId = /task[_\s-]?id["']?\s*[:=]\s*["']?([\w-]+)/i.exec(text)?.[1]
    ?? /([\w-]{8,})/.exec(JSON.stringify(r?.result ?? {}))?.[1]
  console.log('preview 任务已提交:', taskId ?? text.slice(0, 200))
  if (!taskId) process.exit(1)

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await sleep(4000)
    const s = await c.call('polling_task_result', { taskId }, { timeoutMs: 15000 }).catch((e) => ({ err: e.message }))
    const st = JSON.stringify(s?.result ?? s ?? '')
    console.log('status:', st.slice(0, 160))
    if (/success|成功|完成|fail|error/i.test(st)) break
  }
} finally {
  c.close()
}
