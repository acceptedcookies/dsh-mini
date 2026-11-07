// 数据断言：只描述业务结果，不替代截图。
export function assertStatus(evidence, name, got, expect) {
  return evidence.check(name, got === expect, `status ${got} expected ${expect}`)
}

export function assertTrue(evidence, name, value, detail = '') {
  return evidence.check(name, value === true, detail)
}

export function summarize(payload) {
  const failed = payload.checks.filter((c) => !c.ok)
  return {
    status: payload.status,
    pass: payload.checks.length - failed.length,
    fail: failed.length,
    shots: payload.shots.length,
    control_mock: payload.control_mock,
    deferred: payload.deferred,
    evidence: payload.ran_at,
  }
}
