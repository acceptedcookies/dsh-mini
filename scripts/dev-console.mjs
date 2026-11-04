// DevTools 真机调试 console 抓取：automator.connect 挂 console 监听。
// 前提：DevTools → 设置 → 安全设置 → 服务端口 已开启（默认 ws 9420）。
// 用法: node scripts/dev-console.mjs [--port 9420] [--eval "JS表达式"] [--duration 120]
import automator from 'miniprogram-automator'

const args = process.argv.slice(2)
const argOf = (k, d) => {
  const i = args.indexOf(k)
  return i !== -1 ? args[i + 1] : d
}
const PORT = Number(argOf('--port', '9420'))
const EVAL = argOf('--eval', '')
const DURATION_S = Number(argOf('--duration', '120'))

let miniProgram
try {
  miniProgram = await automator.connect({ wsEndpoint: `ws://localhost:${PORT}` })
} catch (e) {
  console.error(`连接失败: ${e.message}`)
  console.error('→ DevTools 开启「设置 → 安全设置 → 服务端口」后重试')
  process.exit(2)
}

miniProgram.on('console', (msg) => {
  const args = (msg.args ?? []).map((a) => {
    try {
      return typeof a === 'object' ? JSON.stringify(a).slice(0, 500) : String(a)
    } catch {
      return '[unprintable]'
    }
  })
  console.log(`[${msg.type}]`, ...args)
})
miniProgram.on('exception', (msg) => console.log('[exception]', JSON.stringify(msg).slice(0, 800)))

if (EVAL.length > 0) {
  try {
    const result = await miniProgram.evaluate(EVAL)
    console.log('[eval]', JSON.stringify(result, null, 2)?.slice(0, 2000) ?? result)
  } catch (e) {
    console.log('[eval:error]', e.message)
  }
}

console.log(`已连接 DevTools，监听 console ${DURATION_S}s…（真机侧操作触发日志即可）`)
await new Promise((r) => setTimeout(r, DURATION_S * 1000))
await miniProgram.disconnect?.()
process.exit(0)
