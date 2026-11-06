// L1（Node）：lint 污染三样本（计划 ⛔11 反例）——删锚/加注册行/未锚 bind:tap 必须检出。
// 全部走 lintAnchors({anchorsPath, root}) 参数化临时 fixture，不动真实树。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { lintAnchors } = await import(`${ROOT}/scripts/dev-cli/lint.mjs`)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

function fixture(wxmlBody, anchors = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mn04-lint-'))
  mkdirSync(`${dir}/pages/x`, { recursive: true })
  writeFileSync(`${dir}/pages/x/x.wxml`, wxmlBody)
  const ap = `${dir}/anchors.json`
  writeFileSync(ap, JSON.stringify({ schema: 'dsh-mini.anchors.v1', anchors }, null, 2))
  return { root: dir, anchorsPath: ap }
}

// 基线干净面：1 锚定交互 → 全过
{
  const f = fixture(`<view data-anchor="x.ok" bind:tap="onOk"/><view data-anchor-exempt bindtap="noop"/>`,
    { 'x.ok': { selector: '[data-anchor="x.ok"]' } })
  const r = lintAnchors(f)
  check('基线干净面（0 未锚/0 烂锚/0 未注册）',
    r.counts.unanchored === 0 && r.counts.stale === 0 && r.counts.unregistered === 0,
    JSON.stringify(r.counts))
}

// 污染1：未锚 bind:tap（冒号语法 ⛔11）
{
  const f = fixture(`<view bind:tap="onTap"/><view bindtap="onTap2" data-anchor="x.a"/>`,
    { 'x.a': { selector: '[data-anchor="x.a"]' } })
  const r = lintAnchors(f)
  check('污染: bind:tap 冒号未锚检出', r.counts.unanchored === 1 && r.unanchored[0].includes('onTap'), r.unanchored.join(' | '))
}

// 污染2：无分隔 bindtap 未锚也检出（双形态同权）
{
  const f = fixture(`<view bindtap="onTap"/>`)
  const r = lintAnchors(f)
  check('污染: bindtap 无分隔未锚检出', r.counts.unanchored === 1)
}

// 污染3：删除锚元素 → 注册行变烂锚（stale）
{
  const f = fixture(`<view data-anchor="x.a" bindtap="onA"/>`, {
    'x.a': { selector: '[data-anchor="x.a"]' },
    'x.ghost': { selector: '[data-anchor="x.ghost"]' },
  })
  const r = lintAnchors(f)
  check('污染: 注册行无对应 wxml → 烂锚检出', r.stale.some((s) => s.name === 'x.ghost'), `stale=${JSON.stringify(r.stale.map((s) => s.name))}`)
}

// 污染4：wxml 有锚但注册表缺 → 未注册检出
{
  const f = fixture(`<view data-anchor="x.new" bindtap="onN"/>`)
  const r = lintAnchors(f)
  check('污染: wxml 锚未注册 → 未注册检出', r.unregistered.some((u) => u.startsWith('x.new')), `unreg=${r.unregistered.join(' | ')}`)
}

// 真实树全绿复核
const rr = lintAnchors({ anchorsPath: `${ROOT}/scripts/dev-cli/anchors.json`, root: ROOT })
check('真实树 未锚/烂锚/未注册=0 + 存活率 100%',
  rr.counts.unanchored === 0 && rr.counts.stale === 0 && rr.counts.unregistered === 0 && rr.counts.coverage === 1,
  `unanch=${rr.counts.unanchored} stale=${rr.counts.stale} unreg=${rr.counts.unregistered} cov=${rr.counts.coverage}`)

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
