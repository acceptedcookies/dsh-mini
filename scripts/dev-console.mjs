// 已迁至 scripts/dev-cli/console.mjs —— 此 shim 保旧调用路径。
// 旧参数映射: --eval → -e, --duration/--port 直通, 真机监听补 --via auto。
// 等效新用法: node scripts/dev-cli/console.mjs --via auto [--port 9420] [-e expr] [--duration s]
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const mapped = []
let sawVia = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--eval') { mapped.push('-e', args[++i] ?? '') }
  else if (a === '--via') { sawVia = true; mapped.push(a, args[++i] ?? 'auto') }
  else mapped.push(a)
}
if (!sawVia) mapped.unshift('--via', 'auto')

const p = spawn(process.execPath, [new URL('./dev-cli/console.mjs', import.meta.url).pathname, ...mapped], { stdio: 'inherit' })
p.on('exit', (code) => process.exit(code ?? 0))
