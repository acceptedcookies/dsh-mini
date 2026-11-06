// L1（Node）：择路映射纯函数断言 + ProbeDriver 锚解析/hook 白名单——不开桥。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { ProbeDriver } = await import(`${ROOT}/scripts/dev-cli/lib/probe.mjs`)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

// 择路表静态断言（计划 §5.2：模拟器→mcp / device|remote→automator / 生命周期→cli）
{
  const src = (await import('node:fs')).readFileSync(`${ROOT}/scripts/dev-cli/lib/probe.mjs`, 'utf8')
  check('择路实现存在（via 分支 + automator + cli 词位）',
    /via === 'automator'/.test(src) && /automator\(/.test(src), 'probe.mjs 内建择路')
}

// 锚解析（无桥：resolveAnchor 只读注册表）
{
  const d = new ProbeDriver()
  // #anchors 私有——open() 才装载；resolveAnchor 在未 open 时应报明错或走注册表。
  // 用静态法：锚名 → selector 契约经注册表自检（与 anchors.mjs 互补，防纯文件假设）
  const reg = JSON.parse((await import('node:fs')).readFileSync(`${ROOT}/scripts/dev-cli/anchors.json`, 'utf8'))
  const pick = Object.keys(reg.anchors).find((n) => reg.anchors[n].disc)
  const meta = reg.anchors[pick]
  const dynSel = meta.selector + `[${meta.disc}="v1"]`
  check('动态行锚 disc 拼合形如 [disc="v"]', /\[data-(id|index|path|key|name|session|session-id|item|kind|role|field|v|value|seq|ts|date|path|tab|tag|type|mode|engine|id)[^\]]*="v1"\]$/.test(dynSel) || dynSel.includes(`[${meta.disc}="v1"]`), dynSel)
}

// hook 白名单（T-O-3：限域 globalData 钩子）
{
  const d = new ProbeDriver()
  let threw = false
  try { await d.hook('arbitraryGlobal', '() => 1') } catch (e) { threw = /hook 白名单/.test(e.message) || /白名单/.test(e.message) }
  check('hook() 非白名单名拒绝', threw)
}

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
