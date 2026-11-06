/** dsh-mini 原生客户端的数据模型。所有状态都在小程序内产生和持有。 */

export interface ImageRef {
  id: string
  url: string
  width?: number
  height?: number
}

export interface FileRef {
  id: string
  name: string
  size: number
  path: string
}

export type ToolStatus = 'running' | 'ok' | 'error'

interface ChatItemBase {
  id: string
  seq: number
  /** 事件落地时间(epoch ms),用于轨迹计时;历史条目可能缺失。 */
  ts?: number
}

export type ChatItem = ChatItemBase & (
  | {
      kind: 'user_message'
      text: string
      images?: ImageRef[]
      /** 已解析的 image_url parts（cloud=https artifact、local=data: 内联）——
       *  跨轮历史回放/转录重建用；原始 ImageRef.url 是临时路径跨启动即失效。 */
      imageParts?: Array<{ kind: 'image_url'; url: string }>
      files?: FileRef[]
    }
  | {
      kind: 'assistant_message'
      text: string
      html: string
      thinking?: string
      /** 本轮各 llm_call 步计量（usage=provider 计费 tokens，decodeMs=调用墙钟）——
       *  composer dock 统计 pill/上下文计数的真源；旧条目缺席→统计退隐。 */
      llmCalls?: Array<{ inputTokens?: number; outputTokens?: number; decodeMs?: number }>
    }
  | {
      kind: 'tool_call'
      tool: string
      status: ToolStatus
      title: string
      callId?: string
      detail?: string
      /** 工具参数预览;detail 在部分运行时会被输出覆盖。 */
      args?: string
    }
  | {
      kind: 'tool_result'
      tool: string
      status: 'ok' | 'error'
      summary: string
      detail?: string
    }
  | {
      kind: 'diff'
      path: string
      summary: string
      text: string
    }
  | {
      kind: 'notice'
      level: 'info' | 'warn' | 'error'
      text: string
    }
)

/** 会话引擎戳记（业主 MN03 裁决）：建会话时从 pendingEngine 烙上，此后该会话
 *  的 io.llm/io.state/转录/图片全按戳记车道走，不随全局旋钮漂移。
 *  nano-agent=本地 kernel + BYOK 代理；magpie=本地 kernel + magpie 直连（dev）；
 *  cloud=nanoRuntime 远端执行（未适配——菜单只显示不可选）。 */
export type SessionEngine = 'nano-agent' | 'magpie' | 'cloud'

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  status: 'idle' | 'running' | 'error'
  /** 建会话戳记；旧会话缺席→路由兜底派生（=建时全局语义，行为不变）。 */
  engine?: SessionEngine
  lastMessage?: string
  messageCount?: number
}

export interface SessionSnapshot {
  sessionId: string
  cursor: number
  status: SessionSummary['status']
  items: ChatItem[]
  hasMore: boolean
}

export interface ApprovalRequest {
  id: string
  sessionId: string
  toolName: string
  reason?: string
  callId?: string
  createdAt: number
}

export interface QuestionOption {
  id: string
  label: string
  detail?: string
}

export interface Question {
  id: string
  text: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionId: string
  questions: Question[]
}

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled'

export interface StreamingState {
  attemptId: string
  sessionId: string
  text: string
}

export interface UiState {
  sessions: SessionSummary[]
  current?: SessionSnapshot
  streaming?: StreamingState
  approvals: ApprovalRequest[]
  questions: QuestionRequest[]
  loadingSessions: boolean
  loadingSession: boolean
  sending: boolean
  error?: string
}

/** 本地 runtime 向 store 发出的增量事件。 */
export type LocalEvent =
  | { type: 'session.snapshot'; sessionId: string; cursor: number; status: SessionSummary['status']; items: ChatItem[]; hasMore: boolean }
  | { type: 'item.append'; sessionId: string; seq: number; item: ChatItem }
  | { type: 'item.replace'; sessionId: string; seq: number; item: ChatItem }
  | { type: 'assistant.delta'; sessionId: string; attemptId: string; index: number; text: string }
  | { type: 'assistant.settle'; sessionId: string; seq: number; messageId: string }
  | { type: 'status'; sessionId: string; state: 'running' | 'idle' | 'error'; step?: number }
  | { type: 'approval.request'; approval: ApprovalRequest }
  | { type: 'approval.cancel'; approvalId: string }
  | { type: 'question.ask'; question: QuestionRequest }
  | { type: 'error'; code: string; message: string; retryable: boolean }
