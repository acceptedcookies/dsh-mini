// L1（Node）：择路映射纯函数全格断言 + hook 白名单——不开桥。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { ProbeDriver, laneFor } = await import(`${ROOT}/scripts/dev-cli/lib/probe.mjs`)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

// 择路表全格断言（计划 §5.2：模拟器→mcp / device|remote→automator / 生命周期→cli / 缺省→mcp / via 覆写）
{
  const grid = [
    ['act', 'mcp'], ['inject', 'mcp'], ['observe', 'mcp'], ['page', 'mcp'],
    ['clear_cache', 'mcp'], ['preview', 'mcp'],
    ['device.remote', 'automator'], ['console.listen', 'automator'],
    ['lifecycle', 'cli'],
    ['status', 'skill'], ['doctor', 'skill'], ['testaccount', 'skill'],
    ['catalog', 'mcp'], ['task', 'mcp'],
    ['agent', 'agent'], ['agent.chat', 'agent'], ['agent.render', 'agent'],
    ['nonexistent-cap', 'mcp'],           // 缺省回退
    ['anything', 'automator', 'auto'],    // via='auto' 覆写
    ['anything', 'mcp', 'mcp'],           // via 显式
    ['anything', 'skill', 'skill'],       // skill 显式
    ['device.remote', 'mcp', 'mcp'],      // via 覆写高于表
    ['device.remote', 'skill', 'skill'],  // skill 覆写高于表
  ]
  const bad = grid.filter(([cap, want, via]) => laneFor(cap, via) !== want)
  check('laneFor 择路表全格映射', bad.length === 0, bad.length ? bad.map(([c, w, v]) => `${c}(via=${v})→${laneFor(c, v)}≠${w}`).join(';') : `${grid.length} 格全中`)
}

// 动态行锚 disc 合法性（注册表层契约：resolveAnchor --id 拼 [disc="v"] 的前件）
{
  const reg = JSON.parse((await import('node:fs')).readFileSync(`${ROOT}/scripts/dev-cli/anchors.json`, 'utf8'))
  const dyn = Object.entries(reg.anchors).filter(([, m]) => m.disc)
  const bad = dyn.filter(([n, m]) => !/^data-[a-z][a-z0-9-]*$/.test(m.disc))
  check('动态行锚 disc 为合法 data-* 属性名', dyn.length > 0 && bad.length === 0, `${dyn.length} 条 disc, bad=${bad.map(([n]) => n).join(',') || '0'}`)
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
