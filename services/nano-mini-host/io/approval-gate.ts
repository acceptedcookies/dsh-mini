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

type QuestionWaiter = { resolve: (answer: string | null) => void }
const questions = new Map<string, QuestionWaiter>()
let emitQuestion: ((ask: { id: string; sessionId: string; text: string }) => void) | undefined

export function setQuestionEmitter(emitter: ((ask: { id: string; sessionId: string; text: string }) => void) | undefined): void {
  emitQuestion = emitter
}

export function settleHostQuestion(questionId: string, answer: string | null): boolean {
  const waiter = questions.get(questionId)
  if (waiter === undefined) return false
  questions.delete(questionId)
  waiter.resolve(answer)
  return true
}

/** 没有提问 UI 时取消，不挂死。 */
export function askHostQuestion(input: { sessionId: string; text: string }): Promise<string | null> {
  if (emitQuestion === undefined) return Promise.resolve(null)
  const id = `question-${Date.now().toString(16)}-${seq += 1}`
  return new Promise((resolve) => {
    questions.set(id, { resolve })
    emitQuestion?.({ id, sessionId: input.sessionId, text: input.text })
  })
}

export function askHostApproval(input: { sessionId: string; toolName: string; reason?: string }): Promise<'allow' | 'deny'> {
  const id = `approval-${Date.now().toString(16)}-${seq += 1}`
  if (emitApproval === undefined) return Promise.resolve('deny')
  return new Promise((resolve) => {
    pending.set(id, { resolve })
    emitApproval?.({ id, sessionId: input.sessionId, toolName: input.toolName, reason: input.reason })
  })
}
