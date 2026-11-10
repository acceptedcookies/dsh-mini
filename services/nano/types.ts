export interface NanoEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string } | string
  trace_uuid?: string
}

export interface NanoTokens {
  access_token: string
  refresh_token: string
  expires_in?: number
  refresh_expires_in?: number
  kid?: string
}

export interface NanoUser {
  user_uuid: string
  display_name: string
  identity_provider?: string
  login_identifier?: string
}

export interface NanoTeam {
  team_uuid: string
  team_name: string
  team_slug?: string
  membership_level?: number
  plan_level?: number
}

export interface NanoAuthData {
  tokens: NanoTokens
  user: NanoUser
  team?: NanoTeam
  snapshot?: Record<string, unknown>
}

export interface NanoSessionSummary {
  session_uuid: string
  conversation_uuid?: string | null
  status: string
  last_phase?: string | null
  last_seen_at?: string | null
  created_at?: string | null
  started_at?: string | null
  title?: string | null
  message_mutation_version?: string
  workspace_storage_version?: string
}

export interface NanoSessionList {
  sessions: NanoSessionSummary[]
  next_cursor?: string | null
}

export interface NanoCreatedSession {
  session_uuid: string
  conversation_uuid?: string | null
  status: string
  ttl_seconds?: number
  created_at?: string
  start_url?: string
}

export interface NanoStartResult {
  session_uuid?: string
  status?: string
  session_status?: string
  first_event_seq?: number
  resume_cursor?: string | null
  [key: string]: unknown
}

export interface NanoHistoryItem {
  message_uuid: string
  turn_uuid?: string | null
  role?: 'user' | 'assistant' | 'system'
  kind?: string
  body?: Record<string, unknown>
  created_at?: string
  global_seq?: number | null
  event_seq?: number | null
  emit_seq?: number | null
  [key: string]: unknown
}

export interface NanoHistory {
  items?: NanoHistoryItem[]
  messages?: NanoHistoryItem[]
  last_event_seq?: number
  next_cursor?: string | null
}

export interface NanoFrame {
  kind?: string
  seq?: number
  name?: string
  payload?: Record<string, unknown>
  confirmation_uuid?: string
  confirmation_kind?: string
  status?: string
  request_uuid?: string
  session_uuid?: string
  cursor?: string
  resume_cursor?: string
  last_event_seq?: number
  stream_uuid?: string
}

export interface NanoConfirmationFrame {
  kind: 'session.confirmation.request' | 'session.confirmation.update'
  confirmation_uuid?: string
  confirmation_kind?: string
  status?: string
  payload?: Record<string, unknown>
  request_uuid?: string
  created_at?: string
  expires_at?: string
}

export class NanoApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'request.error', status = 0) {
    super(message)
    this.name = 'NanoApiError'
    this.code = code
    this.status = status
  }
}

export interface NanoWorkspaceFile {
  virtual_path: string
  size_bytes?: number
  mime?: string
  last_modified_at?: string
}

export interface NanoWorkspaceFiles {
  files: NanoWorkspaceFile[]
  next_cursor?: string | null
}

export interface NanoTodo {
  todo_uuid: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked'
  created_at?: string
  updated_at?: string
}

export interface NanoTodoList {
  todos: NanoTodo[]
}
