/**
 * session 诊断 bundle（MN03 G2）——workspace 按钮与 devtools MCP/automator
 * 共用同一份真源：globalData.__diagnostics(sid) 经 evaluate 直达；
 * 页面按钮走同一函数产出 bundle 复制/落 vfs。
 * schema 版本化（dsh-mini.diag.v1）——下游 agentic 工具按 schema 断言。
 */

import { errorBus, type ErrorReport } from './error-report'
import { sessionStore } from './session-store'
import { currentRoute, lastRouteError } from './fx/dev'
import { readSessionPointer, type SessionPointer } from './nano-mini-host/transcript'
import { vfsStore } from './vfs/store'
import { storage } from './storage'
import { APP_VERSION } from './config'
import type { ChatItem, SessionSummary } from '../types/protocol'

export const DIAG_SCHEMA = 'dsh-mini.diag.v1'

export interface SessionDiagnostics {
  schema: string
  ts: number
  runtime: {
    lane: string
    label: string
    route: string
    routeErr?: string
    model?: string
  }
  session?: {
    id: string
    title: string
    status: SessionSummary['status']
    cursor: number
    hasMore: boolean
    itemCount: number
    byKind: Record<string, number>
    /** 末尾窗口（默认 20 行）——全量走 transcript/vfs，诊断只带尾部上下文。 */
    lastItems: ChatItem[]
    streaming?: { attemptId: string; text: string }
  }
  sessions: Array<Pick<SessionSummary, 'id' | 'title' | 'status' | 'updatedAt' | 'messageCount'>>
  durable: {
    sessionPtr?: SessionPointer
  }
  vfs: {
    mounts: Array<{ name: string; sessions: string[] }>
    sessionRows: Array<{ path: string; size: number | undefined; mime: string | undefined }>
  }
  errors: {
    recent: ErrorReport[]
    openToasts: number
    openModal?: string
    pending: number
  }
  env: {
    version: string
    permission?: string
    model?: string
    planMode: boolean
  }
}

const LAST_ITEMS_CAP = 20
const SESSION_ROWS_CAP = 40

/** sid 缺席=当前会话（store.current），仍缺席→无 session 段的整体诊断。 */
export function sessionDiagnostics(sessionId?: string): SessionDiagnostics {
  const state = sessionStore.getState()
  const route = currentRoute()
  const routeErr = lastRouteError()
  const sid = sessionId ?? state.current?.sessionId
  const snapshot = sid !== undefined && state.current?.sessionId === sid ? state.current : undefined
  const summary = sid !== undefined ? state.sessions.find((s) => s.id === sid) : undefined

  const items = snapshot?.items ?? []
  const byKind: Record<string, number> = {}
  for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1

  const busState = errorBus.state()
  const sessionRows = sid === undefined
    ? []
    : vfsStore.allRows()
        .filter((row) => row.virtual_path.startsWith(`/data/${sid}/`))
        .slice(0, SESSION_ROWS_CAP)
        .map((row) => ({ path: row.virtual_path, size: row.size_bytes, mime: row.mime }))

  return {
    schema: DIAG_SCHEMA,
    ts: Date.now(),
    runtime: {
      lane: sessionStore.runtimeLane(),
      label: sessionStore.runtimeLabel(),
      route: route.mode,
      ...(routeErr !== undefined ? { routeErr: routeErr.message } : {}),
      model: storage.getModel(),
    },
    ...(sid !== undefined
      ? {
          session: {
            id: sid,
            title: summary?.title ?? '',
            status: snapshot?.status ?? summary?.status ?? 'idle',
            cursor: snapshot?.cursor ?? 0,
            hasMore: snapshot?.hasMore ?? false,
            itemCount: items.length || (summary?.messageCount ?? 0),
            byKind,
            lastItems: items.slice(-LAST_ITEMS_CAP),
            ...(state.streaming !== undefined && state.streaming.sessionId === sid
              ? { streaming: { attemptId: state.streaming.attemptId, text: state.streaming.text } }
              : {}),
          },
        }
      : {}),
    sessions: state.sessions.map((s) => ({
      id: s.id, title: s.title, status: s.status, updatedAt: s.updatedAt, messageCount: s.messageCount,
    })),
    durable: {
      ...(sid !== undefined ? { sessionPtr: readSessionPointer(sid) } : {}),
    },
    vfs: {
      mounts: vfsStore.allMounts().map((m) => ({ name: m.name, sessions: [...m.sessions] })),
      sessionRows,
    },
    errors: {
      recent: errorBus.recent(20),
      openToasts: busState.toasts.length,
      ...(busState.modal !== undefined ? { openModal: busState.modal.code } : {}),
      pending: busState.pendingCount,
    },
    env: {
      version: APP_VERSION,
      permission: storage.getPermission(),
      model: storage.getModel(),
      planMode: storage.getPlanMode() === true,
    },
  }
}
