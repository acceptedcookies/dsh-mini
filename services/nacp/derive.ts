/**
 * canonical → LocalEvent / ChatItem。未知 kind 在这里失败，不吞成空事件。
 * fork 三 kind 只物化成 notice，文案带 absent；不实现 fork 业务。
 */

import type { ChatItem, LocalEvent } from '../../types/protocol'
import {
  type CanonicalEvent,
  type StreamEventKind,
  isStreamEventKind,
} from './types'

export type Derived =
  | { surface: 'local-event'; event: LocalEvent }
  | { surface: 'chat-item'; item: ChatItem }

function sessionId(ev: CanonicalEvent): string {
  return ev.session_uuid ?? ''
}

function notice(ev: CanonicalEvent, text: string, level: 'info' | 'warn' | 'error' = 'info'): Derived {
  return {
    surface: 'chat-item',
    item: {
      kind: 'notice',
      id: ev.event_uuid ?? '',
      seq: ev.event_seq ?? 0,
      ts: Date.now(),
      level,
      text,
    },
  }
}

function absentNotice(kind: StreamEventKind, ev: CanonicalEvent): Derived {
  return notice({ ...ev, kind: 'system.notify', absent_reason: 'absent', reason: 'absent' }, `absent: ${kind}`)
}

export function derive(input: CanonicalEvent): Derived {
  if (!isStreamEventKind(input.kind)) {
    throw new Error(`unknown canonical kind: ${String((input as { kind?: unknown }).kind)}`)
  }
  const kind = input.kind
  switch (kind) {
    case 'tool.call':
      return {
        surface: 'chat-item',
        item: {
          kind: 'tool_call',
          id: input.event_uuid ?? input.tool_call_id ?? '',
          seq: input.event_seq ?? 0,
          tool: input.tool_name ?? '',
          status: 'running',
          title: input.tool_name ?? '',
          callId: input.tool_call_id ?? input.request_uuid,
          args: input.arguments !== undefined ? JSON.stringify(input.arguments) : undefined,
        },
      }
    case 'tool.call.progress':
      return notice(input, input.chunk ?? '')
    case 'tool.call.result':
      return {
        surface: 'chat-item',
        item: {
          kind: 'tool_result',
          id: input.event_uuid ?? '',
          seq: input.event_seq ?? 0,
          tool: input.tool_name ?? '',
          status: 'ok',
          summary: typeof input.result === 'string' ? input.result : JSON.stringify(input.result ?? ''),
        },
      }
    case 'tool.call.cancelled':
      return {
        surface: 'chat-item',
        item: {
          kind: 'tool_result',
          id: input.event_uuid ?? '',
          seq: input.event_seq ?? 0,
          tool: input.tool_name ?? '',
          status: 'error',
          summary: input.reason ?? 'cancelled',
        },
      }
    case 'hook.broadcast':
      return notice(input, input.event_name ?? 'hook.broadcast')
    case 'session.update':
      return {
        surface: 'local-event',
        event: {
          type: 'status',
          sessionId: sessionId(input),
          state: 'running',
        },
      }
    case 'turn.begin':
      return { surface: 'local-event', event: { type: 'status', sessionId: sessionId(input), state: 'running' } }
    case 'turn.end':
      return { surface: 'local-event', event: { type: 'status', sessionId: sessionId(input), state: 'idle' } }
    case 'compact.notify':
      return notice(input, `compact.notify:${input.status ?? ''}`)
    case 'compact.micro':
      return notice(
        input,
        `compact.micro:${input.compacted_count ?? 0}:${(input.tool_call_ids ?? []).length}`,
      )
    case 'system.notify':
      return notice(
        input,
        input.absent_reason === 'absent' ? `absent: ${input.message ?? input.reason ?? ''}` : (input.message ?? ''),
        input.severity === 'error' ? 'error' : input.severity === 'warning' ? 'warn' : 'info',
      )
    case 'system.error':
      return {
        surface: 'local-event',
        event: {
          type: 'error',
          code: 'system.error',
          message: typeof input.error === 'string' ? input.error : JSON.stringify(input.error ?? ''),
          retryable: false,
        },
      }
    case 'llm.delta':
      return {
        surface: 'local-event',
        event: {
          type: 'assistant.delta',
          sessionId: sessionId(input),
          attemptId: input.turn_uuid ?? input.event_uuid ?? '',
          index: input.event_seq ?? 0,
          text: input.content ?? '',
        },
      }
    case 'model.fallback':
      return notice(input, `model.fallback:${input.requested_model_id ?? ''}→${input.fallback_model_id ?? ''}`)
    case 'session.fork.created':
    case 'session.message_fork.created':
    case 'session.message_regenerate.started':
      return absentNotice(kind, input)
    default: {
      const _never: never = kind
      throw new Error(`unknown canonical kind: ${String(_never)}`)
    }
  }
}
