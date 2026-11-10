/**
 * kernel 与 fx 共用的一条审批记录。没有挂上 UI 时拒绝，避免轮次挂死。
 */

export interface ApprovalAsk {
  id: string
  sessionId: string
  toolName: string
  reason?: string
}

type Waiter = { resolve: (verdict: 'allow' | 'deny') => void }

const pending = new Map<string, Waiter>()
let emitApproval: ((ask: ApprovalAsk) => void) | undefined
let seq = 0

export function setApprovalEmitter(emitter: ((ask: ApprovalAsk) => void) | undefined): void {
  emitApproval = emitter
}

export function settleHostApproval(approvalId: string, verdict: 'allow' | 'deny'): boolean {
  const waiter = pending.get(approvalId)
  if (waiter === undefined) return false
  pending.delete(approvalId)
  waiter.resolve(verdict)
  return true
}

export function askHostApproval(input: { sessionId: string; toolName: string; reason?: string }): Promise<'allow' | 'deny'> {
  const id = `approval-${Date.now().toString(16)}-${seq += 1}`
  if (emitApproval === undefined) return Promise.resolve('deny')
  return new Promise((resolve) => {
    pending.set(id, { resolve })
    emitApproval?.({ id, sessionId: input.sessionId, toolName: input.toolName, reason: input.reason })
  })
}
