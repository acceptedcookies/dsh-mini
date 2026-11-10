/**
 * gate-lock.mjs — mini-skin 门脚本互斥锁（MS03 准入补强调）
 *
 * 背景：test/spike/mini-skin/node-checks.mjs 的自测会原地写 tracked 文件
 * （assets/skins/dsh-default.json、component-matrix.json、skin.gen.wxss）并临时
 * 创建 components/ms02-probe-<pid>/。并发运行会把门打成假红并把工作树弄脏；
 * 并发 review 实测到 96/97 假 FAIL + planted 残留。此锁把下列门串行化：
 *   node-checks.mjs · build-skin.mjs · skin-equiv-check.mjs · token-audit.mjs
 *
 * 语义：
 *   - DSH_GATE_PID 已由父进程设置（node-checks 的 runNode 子进程）→ 视为已持锁，
 *     直接放行（避免 build-skin --check 子调用死锁）。
 *   - 锁 = .anote/gate.lock，openSync 'wx' 原子竞争；持有期间每 10s 续 mtime。
 *   - 等锁上限 120s；检测到持锁 PID 已死（kill(pid,0) ESRCH）则夺锁。
 *   - release() 删除锁文件；process.on('exit') 兜底（SIGKILL 以外均可）。
 *
 * 崩溃自愈（startupHeal，node-checks 主入口调用一次）：
 *   - 清理 components/ms02-probe-*（任意残留探针目录）。
 *   - 若 .anote/plant/<fileKey>.planting 标记存在且目标 tracked 文件含「"planted"」
 *     字面量，则用 `git show HEAD:<file>` 恢复并删标记（被 SIGKILL 打断的 plant）。
 */
import { existsSync, openSync, closeSync, unlinkSync, utimesSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname
const LOCK = join(ROOT, '.anote', 'gate.lock')
const PLANT_DIR = join(ROOT, '.anote', 'plant')
const WAIT_MS = 120_000
const TOUCH_MS = 10_000

let touchTimer = null
let held = false

function lockAlive() {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8').split('\n')[0])
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      process.kill(pid, 0)
      return true
    }
  } catch (e) {
    if (e && e.code === 'ESRCH') return false
    // 锁文件读不到/为空/EPERM：按已死处理，夺锁
    if (e && e.code === 'EPERM') return true
  }
  return false
}

export function acquireGate() {
  if (process.env.DSH_GATE_PID) return // 父进程已持锁（node-checks 子调用）
  mkdirSync(join(ROOT, '.anote'), { recursive: true })
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx')
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`)
      closeSync(fd)
      held = true
      touchTimer = setInterval(() => { try { utimesSync(LOCK, new Date(), new Date()) } catch { /* noop */ } }, TOUCH_MS)
      touchTimer.unref()
      process.env.DSH_GATE_PID = String(process.pid)
      return
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        if (!lockAlive()) { try { unlinkSync(LOCK) } catch { /* noop */ } continue }
        if (Date.now() > deadline) throw new Error('gate lock 等待超时（120s）——另一门进程仍在运行')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
        continue
      }
      throw e
    }
  }
}

export function releaseGate() {
  if (touchTimer !== null) { clearInterval(touchTimer); touchTimer = null }
  if (held) { held = false; try { unlinkSync(LOCK) } catch { /* noop */ } }
}

process.on('exit', releaseGate)

const PLANT_KEYS = [
  { marker: 'dsh-default.json.planting', file: 'assets/skins/dsh-default.json', residue: '"planted"' },
  { marker: 'component-matrix.json.planting', file: 'test/spike/mini-skin/component-matrix.json', residue: '"ms02-missing"' },
  { marker: 'skin.gen.wxss.planting', file: 'skin.gen.wxss', residue: '--dsw-upd-height: 99vh' },
]

/** node-checks 主入口调用：清上次被 SIGKILL 打断留下的 plant 残迹 + 探针目录。 */
export function startupHeal() {
  // 兼容旧残骸：ms02-probe（无 PID 后缀，旧实现遗留）也要清
  const componentsDir = join(ROOT, 'components')
  if (existsSync(componentsDir)) {
    for (const e of readdirSync(componentsDir, { withFileTypes: true })) {
      if (e.isDirectory() && /^ms02-probe(-\d+)?$/.test(e.name)) {
        rmSync(join(componentsDir, e.name), { recursive: true, force: true })
      }
    }
  }
  if (!existsSync(PLANT_DIR)) return
  for (const { marker, file, residue } of PLANT_KEYS) {
    const flag = join(PLANT_DIR, marker)
    if (!existsSync(flag)) continue
    const abs = join(ROOT, file)
    try {
      const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
      if (current.includes(residue)) {
        const original = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8' })
        writeFileSync(abs, original)
      }
    } finally {
      try { unlinkSync(flag) } catch { /* noop */ }
    }
  }
}
