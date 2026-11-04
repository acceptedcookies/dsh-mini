import { NANO_WS_BASE_URL } from '../config'
import { getAccessToken, traceUuid } from './http'
import { NanoApiError, type NanoFrame } from './types'

export interface NanoStreamHandlers {
  onFrame: (frame: NanoFrame) => void
  onState?: (state: 'open' | 'close' | 'error') => void
  onError?: (error: NanoApiError) => void
}

export interface NanoStream {
  close(): void
  getCursor(): number
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]
const HEARTBEAT_MS = 15000

function socketUrl(sessionId: string, token: string, cursor: number): string {
  const params = [
    `access_token=${encodeURIComponent(token)}`,
    `trace_uuid=${traceUuid()}`,
  ]
  if (cursor > 0) params.push(`resume_cursor=${encodeURIComponent(String(cursor))}`)
  return `${NANO_WS_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/ws?${params.join('&')}`
}

export function connectNanoStream(
  sessionId: string,
  initialCursor: number,
  handlers: NanoStreamHandlers,
): NanoStream {
  const token = getAccessToken()
  if (token === undefined) throw new NanoApiError('登录已失效', 'AUTH_REQUIRED', 401)

  let task: WechatMiniprogram.SocketTask | undefined
  let cursor = Math.max(0, Math.trunc(initialCursor))
  let closed = false
  let reconnectIndex = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  const clearTimers = () => {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
  }

  const send = (data: string) => {
    try {
      task?.send({ data })
    } catch {
      // The socket may have closed between a timer tick and this send.
    }
  }

  const heartbeat = () => {
    send(JSON.stringify({ message_type: 'session.heartbeat', body: { ts: Date.now() } }))
  }

  const scheduleReconnect = () => {
    if (closed) return
    const delay = RECONNECT_DELAYS[Math.min(reconnectIndex, RECONNECT_DELAYS.length - 1)] ?? 30000
    reconnectIndex += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (!closed) open()
    }, delay)
  }

  const open = () => {
    clearTimers()
    const socket = wx.connectSocket({ url: socketUrl(sessionId, token, cursor) })
    task = socket
    socket.onOpen(() => {
      reconnectIndex = 0
      handlers.onState?.('open')
      send(JSON.stringify({ message_type: 'session.resume', body: { last_seen_seq: cursor } }))
      heartbeat()
      heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
    })
    socket.onMessage((event) => {
      let frame: NanoFrame
      try {
        frame = JSON.parse(event.data as string) as NanoFrame
      } catch {
        return
      }
      if (typeof frame.seq === 'number' && Number.isFinite(frame.seq) && frame.seq > cursor) {
        cursor = frame.seq
        send(JSON.stringify({ message_type: 'session.stream.ack', body: { stream_uuid: 'main', acked_seq: cursor } }))
      }
      handlers.onFrame(frame)
    })
    socket.onClose(() => {
      clearTimers()
      if (closed) return
      handlers.onState?.('close')
      scheduleReconnect()
    })
    socket.onError(() => {
      clearTimers()
      if (closed) return
      handlers.onState?.('error')
      scheduleReconnect()
    })
  }

  open()

  return {
    close() {
      closed = true
      clearTimers()
      try {
        task?.close({})
      } catch {
        // Ignore close races.
      }
      task = undefined
    },
    getCursor() {
      return cursor
    },
  }
}
