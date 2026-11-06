// 已迁至 scripts/dev-cli/visual.mjs —— 此 shim 保旧调用路径（--port 直通）。
// 等效新用法: node scripts/dev-cli/visual.mjs [--port 9420] [--out .anote/shots]
import { spawn } from 'node:child_process'

const p = spawn(process.execPath, [new URL('./dev-cli/visual.mjs', import.meta.url).pathname, ...process.argv.slice(2)], { stdio: 'inherit' })
p.on('exit', (code) => process.exit(code ?? 0))
