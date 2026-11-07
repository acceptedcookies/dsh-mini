// 每条 sim 的双形态调度。默认 both；live 条件不足时记 live-blocked，不报 PASS。
import { summarize } from './assertions.mjs'

export function modeOf(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--mode')
  const mode = i >= 0 ? argv[i + 1] : 'both'
  if (!['both', 'mock', 'live'].includes(mode)) throw new Error(`--mode ∈ both|mock|live，收到 ${mode}`)
  return mode
}

export async function runModes({ sim, mode, mock, live }) {
  const out = {}
  if (mode === 'both' || mode === 'mock') out.mock = await mock()
  if (mode === 'both' || mode === 'live') out.live = await live()
  const statuses = Object.values(out).map((r) => r.status)
  const ok = statuses.every((s) => s === 'mock-pass' || s === 'live-pass')
  console.log(JSON.stringify({ sim, mode, results: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, summarize(v)])) }, null, 2))
  if (!ok) process.exitCode = 1
  return out
}
