/**
 * session 诊断 bundle（MN03 G2）——workspace 按钮与 devtools MCP/automator
 * 共用同一份真源：globalData.__diagnostics(sid) 经 evaluate 直达；
 * 页面按钮走同一函数产出 bundle 复制/落 vfs。
 * schema 版本化（dsh-mini.diag.v1）——下游 agentic 工具按 schema 断言。
 */

import { errorBus, type ErrorReport } from './error-report'
import { sessionStore } from './session-store'
import { currentRoute, lastRouteError } from './fx/dev'
import { readSessionPointer, sessionSyncMap, type SessionPointer } from './nano-mini-host/transcript'
import { routeDefaultEngine, pendingEngine, magpieAvailable } from './session-engine'
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
    /** 引擎面（MN03）：下一次建会话的引擎 + magpie 选项可见闸。 */
    engine: { pending: string; magpieAvailable: boolean }
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
  sessions: Array<Pick<SessionSummary, 'id' | 'title' | 'status' | 'updatedAt' | 'messageCount'> & {
    /** 本地/云端同步态（BL-4）：local=无远端行；synced=水位覆盖最新；pending=待上行。 */
    sync: { state: 'local' | 'synced' | 'pending'; lastSeq?: number; syncedAt?: number }
  }>
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
      // 引擎面（MN03）：下一次建会话的引擎 + magpie 选项可见闸。
      engine: { pending: pendingEngine(), magpieAvailable: magpieAvailable() },
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
    sessions: (() => {
      // 同步态三态（BL-4 真机「本地 vs 已云端同步」区分接口）：无指针=local；
      // 指针水位覆盖最新=synced；指针旧于会话更新=pending。
      const syncMap = sessionSyncMap()
      return state.sessions.map((s) => {
        const ptr = syncMap.get(s.id)
        const syncState = ptr === undefined ? 'local' : ptr.updated_ms >= s.updatedAt ? 'synced' : 'pending'
        return {
          id: s.id, title: s.title, status: s.status, updatedAt: s.updatedAt, messageCount: s.messageCount,
          // 引擎戳记（MN03）：戳记缺席的旧会话暴露派生值并注明 derived——
          // 诊断面如实区分「烙上的」与「按路由推的」。
          engine: { value: s.engine ?? routeDefaultEngine(), stamped: s.engine !== undefined },
          sync: { state: syncState, ...(ptr !== undefined ? { lastSeq: ptr.last_seq, syncedAt: ptr.updated_ms } : {}) },
        }
      })
    })(),
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
