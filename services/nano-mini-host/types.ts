/**
 * nano-mini-host 类型真源 —— Io{llm,tool,state} 注入面 + durable 记录 + worker 五端点契约。
 * 真源登记：docs/truth/mini-nano/MN01-qna.md T-O-3/T-O-4/T-O-5。
 * kernel 本体经构建产物（subpkg/kernel/kernel.js | vendor/kernel.cjs）require 载入，
 * 此处只声明宿主消费的子集形状（KernelModule），不把 npm 包引入依赖面。
 */

// ── kernel 模块表面（宿主消费子集）────────────────────────────────────
/** 与 checkpoint.ts KernelCheckpointFragment 同构（版本闸在 restoreFromFragment 内）。 */
export interface KernelCheckpointFragment {
  version: string
  session: unknown
  activeTurn: unknown
  lastAction: string | null
  checkpointedAt: string
}

export interface KernelSnapshot {
  session: KernelSessionLike
  [key: string]: unknown
}

export interface KernelSessionLike {
  [key: string]: unknown
}

export interface KernelTurnLike {
  turnId: string
  epoch: number
  stepIndex: number
  messages: unknown[]
  pendingToolCalls?: Array<{ requestId?: string; name?: string; args?: unknown; input?: unknown }>
  llmFinished?: boolean
  [key: string]: unknown
}

export interface SchedulerSignals {
  hasMoreToolCalls: boolean
  compactRequired: boolean
  cancelRequested: boolean
  timeoutReached: boolean
  llmFinished: boolean
  expectedTurnId?: string
  expectedTurnEpoch?: number
}

export interface StepDecision {
  kind: 'llm_call' | 'tool_exec' | 'hook_emit' | 'compact' | 'wait' | 'finish'
  reason?: string
  toolName?: string
  args?: unknown
  requestId?: string
  [key: string]: unknown
}

export interface KernelModule {
  KERNEL_VERSION: string
  createInitialSessionState(): unknown
  createKernelSnapshot(session: unknown): KernelSnapshot
  applyAction(snap: KernelSnapshot, action: Record<string, unknown>): KernelSnapshot
  scheduleNextStep(snap: KernelSnapshot, signals: SchedulerSignals): StepDecision
  buildCheckpointFragment(snap: KernelSnapshot): KernelCheckpointFragment
  restoreFromFragment(frag: unknown): KernelSnapshot
}

// ── ToolCallResult（kernel tool_result.result 载荷，inline-text 主形态）──
export interface ToolResultProvenance {
  context_layer: string
  context_role: string
  context_property: string
  file_path?: string
}

export interface ToolCallResult {
  kind: 'inline-text' | 'inline-bytes' | 'partial' | 'artifact' | 'rejected' | 'error'
  text?: string
  bytes_base64?: string
  byte_length?: number
  reason?: string
  message?: string
  /** error/rejected 形态必填（kernel ErrorResultSchema——缺 error.code 渲染层即崩）。 */
  error?: { code: string; message: string; details?: Record<string, unknown> }
  effect_state?: 'result-recorded' | 'committed' | 'indeterminate' | 'not-started'
  retryable?: boolean
  provenance?: ToolResultProvenance
}

// ── Io 三注入面（T-O-3：mp 与 sweeper 共享同一 host，差异只在实现）───
export interface LlmToolCall {
  id: string
  name: string
  input: unknown
}

export interface LlmOutput {
  text?: string | null
  toolCalls?: LlmToolCall[]
  usage?: { inputTokens?: number; outputTokens?: number; [key: string]: unknown }
}

export interface CasGetResult {
  body: string
  etag: string
}

export interface CasPutCond {
  ifMatch?: string
  ifNoneMatch?: '*'
}

export interface CasPutResult {
  status: number
  etag?: string
}

/**
 * state 面：CAS 读写 + claim 租约 + alarm 记录读写删 + 前缀列举。
 * 同步或异步返回皆可（localCas 同步、remoteCas 走五端点异步）——泵内一律 await。
 */
export interface IoState {
  get(key: string): CasGetResult | null | Promise<CasGetResult | null>
  putCas(key: string, body: string, cond: CasPutCond): CasPutResult | Promise<CasPutResult>
  listPrefix(prefix: string): string[] | Promise<string[]>
  del(key: string): void | Promise<void>
}

export interface Io {
  llm(messages: unknown[]): Promise<LlmOutput>
  tool(name: string, args: unknown): Promise<ToolCallResult>
  state: IoState
}

// ── durable 记录形状（T-O-5 键区 dsh-mini/{state,claims,alarms,vfs}/）─
export interface ClaimRecord {
  holder: string
  expires: string // ISO8601
}

export interface AlarmRecord {
  sessionId: string
  kind: string // 'turn-resume' 等
  dueAt: number // epoch ms
  fence: string // 写入时 state etag 或 'new'
  attempts?: number // 非终态重臂计数（sweepTick 退避记账，封顶防无界烧）
}

// ── pump 出入参 ───────────────────────────────────────────────────────
export type PumpOutcome =
  | 'completed'
  | 'suspended'
  | 'killed'
  | 'fenced'
  | 'claim-denied'
  | 'step-exhausted'

export interface PumpOptions {
  input?: unknown
  turnId?: string
  maxSteps?: number
  claimTtlMs?: number
  killAfter?: number // 测试钩子：第 N 步后模拟宿主死亡（不落盘）
}

export interface PumpResult {
  outcome: PumpOutcome
  trace: string[]
  rival?: string
  /** durable 快照腐坏/版本错位被按新会话重建——宿主应落账注记（诚实面：不静默丢执行态）。 */
  reset?: boolean
}

export interface SweepResult {
  sessionId: string
  outcome: PumpOutcome
}

// ── worker 五端点契约（T-O-5；openid 服务端注入，请求体不携带）───────
export type WorkerEndpoint =
  | 'state/get'
  | 'state/put-cas'
  | 'claim'
  | 'alarm/due'
  | 'alarm/claim'

export interface StateGetReq { key: string }
export interface StatePutCasReq { key: string; body: string; cond: CasPutCond }
export interface ClaimReq { key: string; holder: string; ttlMs: number }
export interface AlarmDueReq { prefix?: string; now?: number }
export interface AlarmClaimReq { key: string; holder: string }

export interface ApiRes<T> {
  status: number
  body?: T
  error?: string
}

// ── 键区（T-O-5；{openid} 段由服务端注入拼接，客户端只见会话后缀）───
export const KEYSPACE = {
  state: (openid: string, sessionId: string) => `dsh-mini/state/${openid}/${sessionId}`,
  claims: (openid: string, sessionId: string) => `dsh-mini/claims/${openid}/${sessionId}`,
  alarmsPrefix: (openid: string) => `dsh-mini/alarms/${openid}/`,
  alarm: (openid: string, dueTs: number, sessionId: string) =>
    `dsh-mini/alarms/${openid}/${dueTs}-${sessionId}`,
  vfs: (openid: string, contentHash: string) => `dsh-mini/vfs/${openid}/${contentHash}`,
} as const
