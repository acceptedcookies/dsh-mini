/**
 * nacp 投影闭集。17 个 kind 与
 * context/nano-agent/packages/nacp-session/src/stream-event.ts STREAM_EVENT_KINDS 对齐。
 * 不增 kind。字段只收上游 schema 已有的名字；没有索引签名。
 */

export const STREAM_EVENT_KINDS = [
  'tool.call',
  'tool.call.progress',
  'tool.call.result',
  'tool.call.cancelled',
  'hook.broadcast',
  'session.update',
  'turn.begin',
  'turn.end',
  'compact.notify',
  'compact.micro',
  'system.notify',
  'system.error',
  'llm.delta',
  'session.fork.created',
  'session.message_fork.created',
  'session.message_regenerate.started',
  'model.fallback',
] as const

export type StreamEventKind = (typeof STREAM_EVENT_KINDS)[number]

const KIND_SET: ReadonlySet<string> = new Set(STREAM_EVENT_KINDS)

export function isStreamEventKind(value: unknown): value is StreamEventKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

/** 三个 fork/regenerate：有 kind，无业务实现。物化时只许 system.notify + absent。 */
export const UPSTREAM_ABSENT_KINDS = [
  'session.fork.created',
  'session.message_fork.created',
  'session.message_regenerate.started',
] as const

export function isUpstreamAbsentKind(kind: StreamEventKind): boolean {
  return (UPSTREAM_ABSENT_KINDS as readonly string[]).includes(kind)
}

export interface CanonicalEvent {
  kind: StreamEventKind
  session_uuid?: string
  event_uuid?: string
  trace_uuid?: string
  turn_uuid?: string
  tool_name?: string
  request_uuid?: string
  tool_call_id?: string
  arguments?: Record<string, unknown>
  started_at?: string
  emit_seq?: number
  chunk?: string
  is_final?: boolean
  schema_version?: string
  result?: unknown
  cancel_initiator?: 'user' | 'system' | 'parent_cancel'
  reason?: string
  event_name?: string
  caller?: string
  payload_redacted?: unknown
  aggregated_outcome?: unknown
  phase?: string
  partial_output?: string
  status?: string
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
  message?: string
  severity?: 'info' | 'warning' | 'error'
  code?: string
  http_status?: number
  provider?: string
  tokens_before?: number | null
  tokens_after?: number | null
  degraded?: boolean
  event_seq?: number
  episode_uuid?: string
  compacted_count?: number
  tool_call_ids?: string[]
  replacement_refs?: string[]
  error?: unknown
  content_type?: 'text' | 'thinking' | 'tool_use_start' | 'tool_use_delta'
  content?: string
  parent_session_uuid?: string
  child_session_uuid?: string
  conversation_uuid?: string
  from_checkpoint_uuid?: string
  restore_job_uuid?: string
  label?: string
  parent_message_uuid?: string
  child_conversation_uuid?: string
  forked_at?: string
  cloned_message_count?: number
  job_uuid?: string
  from_message_uuid?: string
  mutation_kind?: 'regenerate' | 'edit'
  superseded_count?: number
  replacement_message_uuid?: string | null
  requested_model_id?: string
  fallback_model_id?: string
  fallback_reason?: string
  trigger?: 'auto' | 'manual' | 'manual_async_control'
  trigger_kind?: string
}

export const CANONICAL_KEYS = [
  'kind', 'session_uuid', 'event_uuid', 'trace_uuid', 'turn_uuid', 'tool_name',
  'request_uuid', 'tool_call_id', 'arguments', 'started_at', 'emit_seq', 'chunk',
  'is_final', 'schema_version', 'result', 'cancel_initiator', 'reason', 'event_name',
  'caller', 'payload_redacted', 'aggregated_outcome', 'phase', 'partial_output',
  'status', 'usage', 'message', 'severity', 'code', 'http_status', 'provider',
  'tokens_before', 'tokens_after', 'degraded', 'event_seq', 'episode_uuid',
  'compacted_count', 'tool_call_ids', 'replacement_refs', 'error', 'content_type',
  'content', 'parent_session_uuid', 'child_session_uuid', 'conversation_uuid',
  'from_checkpoint_uuid', 'restore_job_uuid', 'label', 'parent_message_uuid',
  'child_conversation_uuid', 'forked_at', 'cloned_message_count', 'job_uuid',
  'from_message_uuid', 'mutation_kind', 'superseded_count', 'replacement_message_uuid',
  'requested_model_id', 'fallback_model_id', 'fallback_reason', 'trigger',
  'trigger_kind',
] as const

export type ToCanonical = (input: unknown) => CanonicalEvent
