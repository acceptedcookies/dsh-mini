/** dev-cli · automator 通道真源：miniprogram-automator over ws。
 *
 *  连接优先级（与既有 test/mn* ide-*.mjs 同一契约）：
 *    1. AUTO_PORT env → ws://127.0.0.1:$AUTO_PORT（复用已开 IDE，最快）
 *    2. --port / 默认 9420 → ws 直连（DevTools「服务端口」开着时）
 *    3. 回退：CLI `auto --project … --auto-port` 拉起自动化会话，
 *       从 stdout 解析实际 autoPort（复用运行中 IDE 时 CLI 会忽略请求值）
 *
 *  真机调试提示：手机经 USB/真机调试连上后 console 事件经同一 ws 推送——
 *  这是「真机 console」的唯一稳定取道（MCP 的 get_simulator_console 只管模拟器）。
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { PROJECT } from './args.mjs'
import { wrapError } from './pitfalls.mjs'

export const CLI_PATH =
  process.env.WXIDE_CLI_PATH ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

const require = createRequire(new URL('../../../package.json', import.meta.url))
export const automator = require('miniprogram-automator')

export async function connectIde({ port = Number(process.env.AUTO_PORT ?? 9420), project = PROJECT, launchTimeoutMs = 240_000 } = {}) {
  // 1/2. 直连（AUTO_PORT 或默认服务端口）
  try {
    const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
    return { mp, via: 'ws', port }
  } catch { /* fall through to cli auto */ }

  // 3. cli auto 拉起自动化，stdout 解析实际 autoPort
  const proc = spawn(CLI_PATH, ['auto', '--project', project, '--auto-port', String(port === 9420 ? 9602 : port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (out += d))
  const deadline = Date.now() + launchTimeoutMs
  let actual = null
  while (Date.now() < deadline) {
    const m = /"autoPort":\s*(\d+)/.exec(out)
    if (m) { actual = Number(m[1]); break }
    if (proc.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (actual == null) throw wrapError(new Error(`cli auto 未上报 autoPort:\n${out.slice(-800)}`), 'automator.connectIde')
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${actual}` })
      return { mp, via: 'cli-auto', port: actual, proc }
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw wrapError(lastErr ?? new Error('automation ws 不可达'), 'automator.connectIde')
}

/** console/exception 事件 → stdout 行（真机与模拟器同此通道）。 */
export function pipeConsole(mp, { maxArg = 500 } = {}) {
  mp.on('console', (msg) => {
    const args = (msg.args ?? []).map((a) => {
      try { return typeof a === 'object' ? JSON.stringify(a).slice(0, maxArg) : String(a) } catch { return '[unprintable]' }
    })
    console.log(`[${msg.type}]`, ...args)
  })
  mp.on('exception', (msg) => console.log('[exception]', JSON.stringify(msg).slice(0, 800)))
}
