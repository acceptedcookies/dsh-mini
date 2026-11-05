import { NANO_BASE_URL } from '../config'
import {
  NanoApiError,
  type NanoAuthData,
  type NanoConfirmationFrame,
  type NanoCreatedSession,
  type NanoEnvelope,
  type NanoHistory,
  type NanoSessionList,
  type NanoTodoList,
  type NanoWorkspaceFiles,
  type NanoStartResult,
  type NanoUser,
} from './types'

const ACCESS_KEY = 'dsh:nano:access'
const REFRESH_KEY = 'dsh:nano:refresh'
const USER_KEY = 'dsh:nano:user'

let refreshInFlight: Promise<string> | undefined

export function getAccessToken(): string | undefined {
  try {
    const token = wx.getStorageSync<string>(ACCESS_KEY)
    return typeof token === 'string' && token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

export function getRefreshToken(): string | undefined {
  try {
    const token = wx.getStorageSync<string>(REFRESH_KEY)
    return typeof token === 'string' && token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

export function getStoredUser(): NanoUser | undefined {
  try {
    const user = wx.getStorageSync<NanoUser>(USER_KEY)
    return user !== undefined && typeof user === 'object' ? user : undefined
  } catch {
    return undefined
  }
}

export function hasNanoSession(): boolean {
  return getAccessToken() !== undefined || getRefreshToken() !== undefined
}

export function storeAuth(data: NanoAuthData): void {
  wx.setStorageSync(ACCESS_KEY, data.tokens.access_token)
  wx.setStorageSync(REFRESH_KEY, data.tokens.refresh_token)
  wx.setStorageSync(USER_KEY, data.user)
}

export function clearAuth(): void {
  wx.removeStorageSync(ACCESS_KEY)
  wx.removeStorageSync(REFRESH_KEY)
  wx.removeStorageSync(USER_KEY)
}

export function traceUuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  data?: Record<string, unknown>
  auth?: boolean
  timeout?: number
}

function unwrap<T>(body: NanoEnvelope<T> | Record<string, unknown>, status: number): T {
  if (body === null || typeof body !== 'object') {
    throw new NanoApiError('响应格式无效', 'invalid-response', status)
  }
  if (body.ok === false) {
    const raw: unknown = (body as { error?: unknown }).error
    const record = raw !== null && typeof raw === 'object' ? raw as { message?: unknown; code?: unknown } : undefined
    const message = typeof raw === 'string'
      ? raw
      : typeof record?.message === 'string'
        ? record.message
        : `请求失败 (${status})`
    const code = typeof raw === 'string'
      ? raw
      : typeof record?.code === 'string'
        ? record.code
        : `HTTP_${status}`
    throw new NanoApiError(message, code, status)
  }
  const envelope = body as NanoEnvelope<T>
  if (envelope.data !== undefined) return envelope.data
  return body as T
}

function send<T>(url: string, options: RequestOptions, token?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const header: Record<string, string> = {
      'x-trace-uuid': traceUuid(),
    }
    if (options.auth !== false && token !== undefined) {
      header.Authorization = `Bearer ${token}`
    }
    if (options.method === 'POST' || options.method === 'PATCH') {
      header['content-type'] = 'application/json'
    }
    wx.request({
      url,
      method: (options.method ?? 'GET') as unknown as WechatMiniprogram.RequestOption['method'],
      data: options.data,
      header,
      timeout: options.timeout ?? 30000,
      success: (response) => {
        const body = response.data as NanoEnvelope<T> | Record<string, unknown>
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            resolve(unwrap<T>(body, response.statusCode))
          } catch (error) {
            reject(error)
          }
          return
        }
        if (response.statusCode === 401 && options.auth !== false) {
          reject(new NanoApiError('登录已失效', 'AUTH_EXPIRED', 401))
          return
        }
        try {
          unwrap<T>(body, response.statusCode)
        } catch (error) {
          reject(error)
        }
      },
      fail: (error) => {
        reject(new NanoApiError(`${error.errMsg || '网络请求失败'} · ${url}`, 'NETWORK_ERROR', 0))
      },
    })
  })
}

async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight !== undefined) return refreshInFlight
  const refreshToken = getRefreshToken()
  if (refreshToken === undefined) throw new NanoApiError('登录已失效', 'AUTH_REQUIRED', 401)
  refreshInFlight = (async () => {
    const data = await send<NanoAuthData>(
      `${NANO_BASE_URL}/auth/refresh`,
      { method: 'POST', data: { refresh_token: refreshToken }, auth: false },
    )
    storeAuth(data)
    return data.tokens.access_token
  })()
  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = undefined
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.auth === false ? undefined : getAccessToken()
  if (options.auth !== false && token === undefined) {
    const refreshed = await refreshAccessToken()
    return send<T>(`${NANO_BASE_URL}${path}`, options, refreshed)
  }
  try {
    return await send<T>(`${NANO_BASE_URL}${path}`, options, token)
  } catch (error) {
    if (error instanceof NanoApiError && error.status === 401 && options.auth !== false) {
      const refreshed = await refreshAccessToken()
      return send<T>(`${NANO_BASE_URL}${path}`, options, refreshed)
    }
    throw error
  }
}

export async function loginWithEmail(email: string, password: string): Promise<NanoAuthData> {
  const data = await request<NanoAuthData>('/auth/login', {
    method: 'POST',
    data: { email, password },
    auth: false,
  })
  storeAuth(data)
  return data
}

export async function registerWithEmail(email: string, password: string, displayName: string): Promise<NanoAuthData> {
  const data = await request<NanoAuthData>('/auth/register', {
    method: 'POST',
    data: { email, password, display_name: displayName },
    auth: false,
  })
  storeAuth(data)
  return data
}

export async function loginWithWechatCode(code: string, displayName?: string): Promise<NanoAuthData> {
  const data = await request<NanoAuthData>('/auth/wechat/login', {
    method: 'POST',
    data: displayName === undefined ? { code } : { code, display_name: displayName },
    auth: false,
  })
  storeAuth(data)
  return data
}

export async function verifyAccessToken(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/auth/verify', {
    method: 'POST',
    data: {},
  })
}

export async function fetchMe(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/auth/me')
}

export function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => {
        if (result.code.length === 0) reject(new NanoApiError('微信登录没有返回 code', 'WECHAT_CODE_MISSING'))
        else resolve(result.code)
      },
      fail: (error) => reject(new NanoApiError(error.errMsg || '微信登录失败', 'WECHAT_LOGIN_FAILED')),
    })
  })
}

export async function listSessions(): Promise<NanoSessionList> {
  return request<NanoSessionList>('/me/sessions?limit=200')
}

export async function createSession(): Promise<NanoCreatedSession> {
  return request<NanoCreatedSession>('/me/sessions', { method: 'POST', data: {} })
}

export async function startSession(sessionId: string, initialInput: string): Promise<NanoStartResult> {
  return request<NanoStartResult>(`/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
    data: { initial_input: initialInput },
    timeout: 60000,
  })
}

export async function sendInput(sessionId: string, text: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    data: { text },
    timeout: 60000,
  })
}

export async function cancelTurn(sessionId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/sessions/${encodeURIComponent(sessionId)}/turn/cancel`, {
    method: 'POST',
    data: { reason: 'user cancelled' },
  })
}

export async function fetchStatus(sessionId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/sessions/${encodeURIComponent(sessionId)}/status`)
}

export async function fetchHistory(sessionId: string): Promise<NanoHistory> {
  const items: NanoHistory['items'] = []
  let cursor: string | null = null
  let last: NanoHistory = {}
  for (let page = 0; page < 50; page += 1) {
    const query: string = `view=canonical&limit=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
    const data: NanoHistory = await request<NanoHistory>(
      `/sessions/${encodeURIComponent(sessionId)}/history?${query}`,
    )
    last = data
    const pageItems = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.messages)
        ? data.messages
        : []
    items.push(...pageItems)
    const next: string | null | undefined = data.next_cursor
    if (typeof next === 'string' && next.length > 0) cursor = next
    else break
  }
  return { ...last, items, messages: items }
}

export async function decideConfirmation(
  sessionId: string,
  confirmationId: string,
  decision: 'allow' | 'deny',
  reason: string,
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/sessions/${encodeURIComponent(sessionId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
    { method: 'POST', data: { decision, scope: 'once', reason } },
  )
}

export async function renameConversation(conversationId: string, title: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/me/conversations/${encodeURIComponent(conversationId)}/title`,
    { method: 'PATCH', data: { title } },
  )
}

export async function deleteConversation(conversationId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/me/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE' },
  )
}

export type { NanoConfirmationFrame }

export async function fetchWorkspaceFiles(sessionId: string): Promise<NanoWorkspaceFiles> {
  return request<NanoWorkspaceFiles>(`/sessions/${encodeURIComponent(sessionId)}/workspace/files?limit=200`)
}

export async function fetchTodos(sessionId: string): Promise<NanoTodoList> {
  return request<NanoTodoList>(`/sessions/${encodeURIComponent(sessionId)}/todos?status=any`)
}
