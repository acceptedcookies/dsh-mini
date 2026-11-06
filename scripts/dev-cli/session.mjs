// dev-cli · 会话载体（QNA:68 冻结项）：一次 open() 跑整组动作序列，
// 跨 node 调用的 ~8s MCP 桥冷启摊为一次。
//
// 用法:
//   node scripts/dev-cli/session.mjs                 → REPL（stdin 逐行命令，exit/quit 退出）
//   node scripts/dev-cli/session.mjs -f ./steps.txt  → 批处理文件逐行执行
//   echo 'act @composer.input input -v hi' | node scripts/dev-cli/session.mjs
//
// 行内命令语法（与散工具对齐，去 node/文件名前缀）：
//   act @anchor <action> [--value v] [--x --y] [--id v] [--wait s] [--for sel]
//   inject --data '{k:v}' | --call m [--args '[]'] | --hook H --fn 'src' | --mock-wx m [--result j | --fn 'src']
//   eval '<fnSource|expr>'
//   state [-k a,b] [--deep key]
//   geo -s 'sel' [--all]
//   shot [-o path] [--sim] | nav <action> [url] | refresh [--wait ms]
//   scene dark|light|system | --sysinfo '{..}' | --restore
//   reset [--type action]
//   region @anchor [-o dir]
//   console [--grep g] | network [--grep g] | diag [--full]
//   route                                → 当前 route
//   bridge                               → MCP 桥握手计数（复用证据）
//   exit | quit                          → 关闭会话（先 restore 全部 mock）
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { ProbeDriver } from './lib/probe.mjs'
import { bridgeCount } from './lib/mcp.mjs'
import { parseArgs, flagOf } from './lib/args.mjs'

const d = await ProbeDriver.open()
console.log('[session] bridge opened (mcp); anchors loaded')

/** 引号感知分词：'--data {"a":1}' 与 'eval "src with spaces"' 不在引号内断。 */
function tokenize(line) {
  const out = []
  let cur = '', q = null
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch }
    else if (ch === "'" || ch === '"') q = ch
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = '' } }
    else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

async function runLine(line) {
  const { flags, positional } = parseArgs(tokenize(line))
  const [cmd, ...rest] = positional
  const out = async (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

  switch (cmd) {
    case 'act': {
      const [target, action] = rest
      const params = {}
      for (const k of ['value', 'x', 'y', 'type', 'detail', 'name', 'touches', 'changedTouches']) {
        const v = flagOf(flags, k, undefined)
        if (v !== undefined) params[k] = /^{|^\[|^\-?\d/.test(String(v)) ? JSON.parse(v) : v
      }
      const v0 = flagOf(flags, 'v', undefined)
      if (v0 !== undefined && params.value === undefined) params.value = v0
      return out(await d.act(target, action, params, {
        id: flagOf(flags, 'id', undefined),
        wait: flags.wait !== undefined ? Number(flags.wait) : undefined,
        waitForSelector: flagOf(flags, 'for', undefined),
      }))
    }
    case 'inject': {
      if (flags.data !== undefined) return out(await d.setData(JSON.parse(flags.data)))
      if (flags.call !== undefined) return out(await d.callMethod(flags.call, flags.args ? JSON.parse(flags.args) : []))
      if (flags.hook !== undefined) return out(await d.hook(flags.hook, flagOf(flags, 'fn', flagOf(flags, 'e', ''))))
      if (flags['mock-wx'] !== undefined) {
        return out(await d.mockWx(flags['mock-wx'], {
          result: flags.result !== undefined ? JSON.parse(flags.result) : undefined,
          functionDeclaration: flagOf(flags, 'fn', undefined),
        }))
      }
      return out('inject 需 --data|--call|--hook|--mock-wx 之一')
    }
    case 'eval': {
      let src = flagOf(flags, 'e', null) ?? rest.join(' ')
      const isFn = /^\s*(\(|function|async|new\s+Promise)/.test(src)
      if (!isFn) src = `() => (${src})`
      return out(await d.eval(src))
    }
    case 'state': {
      const keys = flagOf(flags, 'k', '')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
      const deep = flagOf(flags, 'deep', null)
      return out(await d.eval(`() => {
        const p = getCurrentPages().pop(); const data = p.data ?? {}
        const keys = ${JSON.stringify(keys)}; const deep = ${JSON.stringify(deep)}
        if (deep) return { route: p.route, value: data?.[deep] }
        const pick = keys.length ? keys : Object.keys(data); const o = { route: p.route }
        for (const k of pick) { try { o[k] = JSON.parse(JSON.stringify(data[k])) } catch { o[k] = String(data[k]) } }
        return o }`))
    }
    case 'geo': {
      const sel = flagOf(flags, 's', '')
      const all = flags.all === true
      return out(await d.eval(`() => new Promise((resolve) => {
        const p = getCurrentPages().pop()
        const rd = (r) => r === null ? null : ({ l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) })
        const q = p.createSelectorQuery(); const out = { route: p.route }
        q[${all} ? 'selectAll' : 'select'](${JSON.stringify(sel)}).boundingClientRect((r) => { out.rect = ${all} ? (r ?? []).map(rd) : rd(r); resolve(out) }).exec()
      })`))
    }
    case 'shot': {
      const { resolve } = await import('node:path')
      const { mkdirSync } = await import('node:fs')
      const out2 = resolve(flagOf(flags, 'o', `.anote/shots/dev-${Date.now()}.png`))
      mkdirSync(out2.slice(0, out2.lastIndexOf('/')), { recursive: true })
      return out(await (flags.sim === true ? d.rawShot(out2) : d.shot(out2)))
    }
    case 'nav': return out(await d.nav(rest[0] ?? 'reLaunch', rest[1], flags.delta !== undefined ? { delta: Number(flags.delta) } : {}))
    case 'refresh': return out(await d.refresh(Number(flagOf(flags, 'wait', '6000'))))
    case 'reset': return out(await d.clearCache(flagOf(flags, 'type', 'cleanStorageCache')))
    case 'scene': {
      const mode = rest[0]
      if (mode === 'dark' || mode === 'light' || mode === 'system') {
        // 设置页用户路径同构：nav → onThemeMode 事件驱动（settings.ts:176）
        await d.nav('reLaunch', '/pages/settings/settings')
        const r = await d.callMethod('onThemeMode', [{ currentTarget: { dataset: { mode } } }])
        await d.nav('navigateBack', undefined, {})
        return out({ scene: mode, callMethod: r })
      }
      if (flags.sysinfo !== undefined) {
        const patch = JSON.parse(flags.sysinfo)
        for (const m of ['getSystemInfoSync', 'getWindowInfo', 'getDeviceInfo', 'getAppBaseInfo']) {
          await d.mockWx(m, { result: patch }).catch(() => {})
        }
        return out({ mocked: Object.keys(patch), registered: d.pendingMocks })
      }
      if (flags.restore === true) {
        for (const m of [...d.pendingMocks]) await d.restoreWx(m)
        return out({ restored: 'all', pending: d.pendingMocks })
      }
      return out('scene dark|light|system | --sysinfo \'{..}\' | --restore')
    }
    case 'region': {
      const target = rest[0]
      const { default: run } = await import('./lib/region-run.mjs').catch(() => ({}))
      if (!run) return out('region 需 P3-03 region.mjs——请用 node scripts/dev-cli/region.mjs')
      return out(await run(d, target, flags))
    }
    case 'console': return out(await d.consoleSnapshot(flagOf(flags, 'grep', null)))
    case 'network': return out(await d.networkSnapshot(flagOf(flags, 'grep', null)))
    case 'diag': return out(await d.diag(flags.full === true))
    case 'route': return out(await d.route())
    case 'bridge': return out({ bridgeCount })
    case 'exit': case 'quit': return 'bye'
    default: return out(`未知命令 '${cmd}'——act/inject/eval/state/geo/shot/nav/refresh/reset/scene/console/network/diag/route/bridge/exit`)
  }
}

const file = flagOf(parseArgs().flags, 'f', null)
const lines = file ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')) : null

try {
  if (lines) {
    for (const l of lines) {
      console.log(`\n>>> ${l}`)
      const r = await runLine(l.trim())
      if (r === 'bye') break
    }
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'probe> ' })
    rl.prompt()
    for await (const line of rl) {
      const t = line.trim()
      if (!t) { rl.prompt(); continue }
      try {
        const r = await runLine(t)
        if (r === 'bye') break
      } catch (e) {
        console.log(`[err] ${e.message}`)
      }
      rl.prompt()
    }
    rl.close()
  }
} finally {
  await d.close()
  console.log(`[session] closed; bridgeCount=${bridgeCount}`)
}
