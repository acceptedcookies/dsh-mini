// evidence 信封：只写当前 sim 目录下的 evidence/{mode}/{UTC}/。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { REPO } from './env.mjs'

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function openEvidence(simDir, mode) {
  const dir = join(simDir, 'evidence', mode, stamp())
  const shots = join(dir, 'shots')
  const artifacts = join(dir, 'artifacts')
  mkdirSync(shots, { recursive: true })
  mkdirSync(artifacts, { recursive: true })
  let head = 'unknown'
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim() } catch { /* detached */ }
  const checks = []
  return {
    dir,
    shots,
    artifacts,
    check(name, ok, detail) {
      checks.push({ name, ok: ok === true, detail: detail ?? '' })
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
      return ok === true
    },
    finish(extra) {
      const failed = checks.some((c) => !c.ok)
      const payload = {
        sim: extra.sim,
        mode,
        git_head: head,
        endpoint: extra.endpoint ?? null,
        control_mock: extra.control_mock ?? [],
        deferred: extra.deferred ?? [],
        checks,
        shots: extra.shots ?? [],
        status: extra.status ?? (failed ? 'fail' : `${mode}-pass`),
        note: extra.note ?? '',
        ran_at: new Date().toISOString(),
      }
      writeFileSync(join(dir, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`)
      return payload
    },
  }
}
