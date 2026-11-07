// sim 错误分类/分级/上下文：唯一目标 = 失败时给出「这是什么 + 有多严重 + 下一步做什么 + 踩坑 ID」。
// 复用 dev-cli pitfalls 真源（matchPitfall/wrapError），sim 侧只做分级与输出。
import { wrapError, matchPitfall } from '../../../scripts/dev-cli/lib/pitfalls.mjs'

/** severity: recoverable（清状态重跑）| needs-ide-restart（重启 DevTools）| needs-operator（人要看/要按）| needs-owner（业主决策） */
const GRADES = [
  { re: /手动真机调试会话|manual-session-conflict/i, severity: 'needs-operator', next: '关闭 DevTools 手动"真机调试"窗、手机退出调试态后重跑' },
  { re: /ios-adapter|spawnProcess|Device disconnected|adapter init error/i, severity: 'needs-ide-restart', next: 'pkill -f wechatwebdevtools 后 cli auto 重拉，只发一次 remote(true)' },
  { re: /remote 未连上|onRemoteDebugConnected|remote-timeout/i, severity: 'needs-ide-restart', next: '重启 DevTools 后重跑；若仍失败查窗口日志 adapter 初始化' },
  { re: /soter-timeout|startSoterAuthentication/i, severity: 'needs-operator', next: '手机保持亮屏，看到生物验证弹窗后按指纹/人脸；超时后重跑' },
  { re: /dsh:sim:live-ticket|401/i, severity: 'recoverable', next: 'wx.removeStorageSync("dsh:sim:live-ticket") 后重跑' },
  { re: /Cloud API isn't enabled|errCode: -1/i, severity: 'recoverable', next: 'eval 上下文先 wx.cloud.init({env}) 再 callFunction' },
  { re: /timeout/i, severity: 'recoverable', next: '检查会话是否存活后重跑' },
]

export function gradeError(err, where = '') {
  const msg = String(err?.message ?? err)
  const p = matchPitfall(msg, where)
  const g = GRADES.find((x) => x.re.test(msg)) ?? { severity: 'recoverable', next: '重跑；若复现登记 pitfall' }
  return { kind: p?.id ?? 'unclassified', pitfallId: p?.id ?? null, severity: g.severity, next: g.next, where, message: msg }
}

/** 打印结构化失败行并返回带 pitfall 前缀的 Error（可继续 throw）。 */
export function fail(where, err) {
  const graded = gradeError(err, where)
  const wrapped = wrapError(err, where)
  console.error(`[sim-error] where=${graded.where} kind=${graded.kind} severity=${graded.severity} next="${graded.next}"`)
  if (wrapped.pitfall !== undefined) console.error(`[sim-error] ${wrapped.message}`)
  const out = wrapped instanceof Error ? wrapped : new Error(String(err))
  out.grade = graded
  return out
}
