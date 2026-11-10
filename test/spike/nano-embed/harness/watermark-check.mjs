// nano-embed · 模拟器内 compact watermark 策略检查（真实 kernel 导出）。
// 不制造假压缩：只验证 resolveCompactPolicyDetailed 的 default/watermark 分支
// 与 shouldArm 的阈值边界。用法: node test/spike/nano-embed/harness/watermark-check.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectIde } from '../../../../scripts/dev-cli/lib/ide.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..', '..', '..', '..')
const evidenceDir = join(root, 'test/spike/nano-embed/evidence/watermark')
const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail: String(detail).slice(0, 600) })

const ide = await connectIde({ port: Number(process.env.AUTO_PORT ?? 9602) })
const info = await ide.mp.evaluate(() => {
  const d = wx.getDeviceInfo()
  return { brand: d.brand, model: d.model, platform: d.platform }
})
try {
  check('env:simulator', info.platform === 'devtools', JSON.stringify(info))
  const out = await ide.mp.evaluate(() => {
    const k = globalThis.__dshKernelBundle
    if (!k) return { error: 'kernel bundle missing' }
    const base = k.resolveCompactPolicyDetailed(undefined, {})
    const fake = { readTeamModelCompactionPolicy: () => Promise.resolve({ team_uuid: 't', model_id: 'm', buffer_size_async: 0.70, health_target_async: 0.50 }) }
    const wm = k.resolveCompactPolicyDetailed(fake, { sessionUuid: 's1', teamUuid: 't1', modelId: 'm1' })
    return Promise.all([base, wm]).then(([b, w]) => ({
      defaultSource: b.source,
      defaultSoft: b.policy.softTriggerPct,
      watermarkSource: w.source,
      watermarkSoft: w.policy.softTriggerPct,
      watermarkHealth: w.policy.healthTargetPct,
      arm0: k.shouldArm({ totalTokens: 0, maxTokens: 1000, responseReserveTokens: 0 }, w.policy),
      arm69: k.shouldArm({ totalTokens: 690, maxTokens: 1000, responseReserveTokens: 0 }, w.policy),
      arm70: k.shouldArm({ totalTokens: 700, maxTokens: 1000, responseReserveTokens: 0 }, w.policy),
      arm80: k.shouldArm({ totalTokens: 800, maxTokens: 1000, responseReserveTokens: 0 }, w.policy),
    }))
  })
  check('kernel:present', !out.error, JSON.stringify(out))
  check('policy:default-source', out.defaultSource === 'default', String(out.defaultSource))
  check('policy:default-soft', out.defaultSoft === 0.65, String(out.defaultSoft))
  check('policy:watermark-source', out.watermarkSource === 'watermark', String(out.watermarkSource))
  check('policy:watermark-soft', out.watermarkSoft === 0.7, String(out.watermarkSoft))
  check('policy:watermark-health', out.watermarkHealth === 0.5, String(out.watermarkHealth))
  check('arm:below-boundary', out.arm69 === false, String(out.arm69))
  check('arm:at-boundary', out.arm70 === true, String(out.arm70))
  check('arm:above-boundary', out.arm80 === true, String(out.arm80))
  check('arm:zero', out.arm0 === false, String(out.arm0))
} catch (e) {
  check('run:error', false, e instanceof Error ? e.message : String(e))
} finally {
  try { await ide.mp.disconnect?.() } catch { /* ignore */ }
  if (ide.proc && ide.proc.exitCode === null) ide.proc.kill('SIGTERM')
}

const status = checks.every((c) => c.ok) ? 'pass' : 'fail'
const record = { spike: 'nano-embed/watermark-check', mode: 'devtools-simulator + real-kernel', device: info, checks, status, ran_at: new Date().toISOString() }
mkdirSync(evidenceDir, { recursive: true })
const file = join(evidenceDir, `${record.ran_at.replace(/[:.]/g, '-')}.json`)
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
console.log(JSON.stringify({ status, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length, evidence: file }, null, 2))
if (checks.some((c) => !c.ok)) for (const c of checks.filter((x) => !x.ok)) console.log('FAIL', c.name, c.detail)
process.exit(status === 'pass' ? 0 : 1)
