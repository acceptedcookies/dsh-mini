#!/usr/bin/env node
// build-theme.mjs — 由 app.less token 单源生成 theme.json（UT-41）
// 暗色值取自 .theme-dark{} 的 --dsw-alias-bg-base；浅色值保留既有窗口观感（勿改 bg-base→#fff 引发的浅色回拉带漂移）。
// 用法: node scripts/build-theme.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const less = readFileSync(ROOT + 'app.less', 'utf8')

const darkBlock = less.match(/\.theme-dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const pick = (block, name) => block.match(new RegExp(`${name}\\s*:\\s*([#\\w().,\\s%]+?);`))?.[1]?.trim()
const darkBg = pick(darkBlock, '--dsw-alias-bg-base')
if (!darkBg) { console.error('FATAL: .theme-dark --dsw-alias-bg-base 未解析到'); process.exit(1) }

const theme = {
  light: {
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f7f8',
    backgroundColorTop: '#f7f7f8',
    backgroundColorBottom: '#f7f7f8',
    backgroundTextStyle: 'dark',
  },
  dark: {
    navigationBarBackgroundColor: darkBg,
    navigationBarTextStyle: 'white',
    backgroundColor: darkBg,
    backgroundColorTop: darkBg,
    backgroundColorBottom: darkBg,
    backgroundTextStyle: 'light',
  },
}
const out = JSON.stringify(theme, null, 2) + '\n'
const target = ROOT + 'theme.json'

if (process.argv.includes('--check')) {
  const cur = readFileSync(target, 'utf8')
  if (cur !== out) { console.error('theme.json 与 token 层漂移——跑 build-theme.mjs 重建'); process.exit(1) }
  console.log('theme.json in-sync ✅')
  process.exit(0)
}
writeFileSync(target, out)
console.log(`theme.json generated · dark bg/nav=${darkBg}`)
