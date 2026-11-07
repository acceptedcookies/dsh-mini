// dev-cli · 页内执行 JS：automation_evaluate 封装。
// 用法:
//   node scripts/dev-cli/eval.mjs -e '() => getCurrentPages().pop().route'
//   node scripts/dev-cli/eval.mjs -e 'expr'            （裸表达式自动包 () => (expr)）
//   node scripts/dev-cli/eval.mjs -f ./probe.js        （文件体 = 完整 fnSource）
// 契约：fnSource 禁顶层 await——异步写 promise 链或 () => new Promise(...)。
import { readFileSync } from 'node:fs'
import { ProbeDriver } from './lib/probe.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const { flags } = parseArgs()
const file = flagOf(flags, 'f', null)
let src = flagOf(flags, 'e', null) ?? (file ? readFileSync(file, 'utf8') : null)
if (!src) {
  console.error('用法: node scripts/dev-cli/eval.mjs -e \'<fnSource|expr>\' | -f <file>')
  process.exit(2)
}
const isFn = /^\s*(\(|function|async|() =>|\(\)\s*=>|new\s+Promise)/.test(src)
if (!isFn) src = `() => (${src})`

const d = await ProbeDriver.open({ via: flagOf(flags, 'via', undefined) })
try {
  const r = await d.eval(src)
  console.log(JSON.stringify(r, null, 2))
} finally {
  d.close()
}
