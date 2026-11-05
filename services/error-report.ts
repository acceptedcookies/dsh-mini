/**
 * error-report/error-handle 抽象（MN03 G1）——全错误面统一收口：
 * 任何 Error/字符串/LocalEvent error 经 classifyError 归一成 ErrorReport
 * （taxonomy：code→category/severity/surface/title/hint），再经 errorBus
 * 路由到三 surface：toast（悬浮自动关+手动关）/ modal（弹窗诊断+复制）/
 * silent（仅台账入 ring buffer——已有专属 UI 面的错误不双弹，供诊断聚合）。
 *
 * 不改 LocalEvent 公共合同（code/message/retryable 沿用）——分类映射属本仓内部面。
 */

import { randomId } from '../utils/uuid'

export type ErrorCategory =
  | 'network' | 'upstream' | 'ticket' | 'runtime' | 'image' | 'protocol'
  | 'storage' | 'vfs' | 'tool' | 'permission' | 'session' | 'route'
  | 'cancelled' | 'unknown'

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal'
export type ErrorSurface = 'toast' | 'modal' | 'silent'

export interface ErrorDiagnostics {
  /** 触发操作名（prompt/open/create/…）。 */
  op?: string
  /** runtime 车道（kernel/fx/local/nano/ui/background）。 */
  lane?: string
  route?: string
  model?: string
  sessionId?: string
  url?: string
  status?: number
  retryable?: boolean
  /** 原始堆栈（复制全文/诊断用）。 */
  stack?: string
  /** 原始补充文本（body 截片等）。 */
  detail?: string
}

export interface ErrorReport {
  id: string
  code: string
  category: ErrorCategory
  severity: ErrorSeverity
  surface: ErrorSurface
  /** 短标题（modal 头部）。 */
  title: string
  /** 用户可读主文案。 */
  message: string
  /** 可操作建议（可选）。 */
  hint?: string
  diagnostics: ErrorDiagnostics
  ts: number
  /** dedupe 同窗合并计数。 */
  count: number
}

interface Taxon {
  category: ErrorCategory
  severity: ErrorSeverity
  surface: ErrorSurface
  title: string
  hint?: string
  retryable?: boolean
}

/** 已知 code 注册表——LocalEvent error.code 与工具/服务错误码在此归类。 */
const TAXONOMY: Record<string, Taxon> = {
  cancelled: { category: 'cancelled', severity: 'info', surface: 'silent', title: '已停止' },
  'ticket-required': {
    category: 'ticket', severity: 'error', surface: 'modal', title: '需要身份验证', retryable: true,
    hint: '票据缺失或已过期。重新发送消息以触发验证，或在设置页重新登记。',
  },
  'image-resolve-failed': {
    category: 'image', severity: 'error', surface: 'modal', title: '图片处理失败', retryable: true,
    hint: '图片未能解析或发布到工件出口。可改发文本，或稍后重试。',
  },
  'kernel-unavailable': {
    category: 'runtime', severity: 'fatal', surface: 'modal', title: '运行时不可用', retryable: false,
    hint: 'kernel 分包不可加载。请重启小程序；反复出现请检查分包完整性。',
  },
  'host-error': { category: 'runtime', severity: 'error', surface: 'modal', title: '运行错误', retryable: true },
  fenced: { category: 'runtime', severity: 'error', surface: 'modal', title: '会话写者冲突', retryable: false,
    hint: '另一进程持有本会话写入权。稍后重试，或确认没有第二处运行。' },
  'claim-denied': { category: 'runtime', severity: 'error', surface: 'modal', title: '会话写者冲突', retryable: false,
    hint: '另一进程持有本会话写入权。稍后重试，或确认没有第二处运行。' },
  'step-exhausted': { category: 'runtime', severity: 'error', surface: 'modal', title: '轮次步数耗尽', retryable: true,
    hint: '本轮达到最大步数未完成。可把任务拆小后重试。' },
  killed: { category: 'runtime', severity: 'error', surface: 'modal', title: '轮次被中断', retryable: true },
  'pump-error': { category: 'runtime', severity: 'error', surface: 'modal', title: '执行引擎错误', retryable: true },
  turn_failed: { category: 'runtime', severity: 'error', surface: 'modal', title: '轮次失败', retryable: true },
  protocol: { category: 'protocol', severity: 'error', surface: 'modal', title: '协议异常', retryable: false,
    hint: '运行时协议返回异常内容。请升级版本或反馈此错误。' },
  'nano.stream': { category: 'upstream', severity: 'error', surface: 'modal', title: '远端会话流异常', retryable: true },
  'nano.prompt': { category: 'upstream', severity: 'error', surface: 'modal', title: '远端发送失败', retryable: true },
  'nano.cancel': { category: 'upstream', severity: 'error', surface: 'modal', title: '远端停止失败', retryable: true },
  'nano.approval': { category: 'upstream', severity: 'error', surface: 'modal', title: '远端审批失败', retryable: true },
  // 启发式归一化码（http status/传输/存储/vfs/权限面抽取）。
  'network-error': { category: 'network', severity: 'warn', surface: 'toast', title: '网络异常', retryable: true,
    hint: '网络请求失败。请检查连接后重试。' },
  'network-timeout': { category: 'network', severity: 'warn', surface: 'toast', title: '请求超时', retryable: true,
    hint: '请求超时。可稍后重试或检查上游连通性。' },
  'upstream-4xx': { category: 'upstream', severity: 'error', surface: 'modal', title: '上游拒绝请求', retryable: false },
  'upstream-auth': { category: 'ticket', severity: 'error', surface: 'modal', title: '上游鉴权失败', retryable: false,
    hint: '401/403——凭证或票据不被接受。请重新登记或重铸票据。' },
  'rate-limit': { category: 'upstream', severity: 'warn', surface: 'toast', title: '触发限流', retryable: true,
    hint: '上游限流（429）。稍后重试。' },
  'upstream-5xx': { category: 'upstream', severity: 'error', surface: 'modal', title: '上游服务错误', retryable: true,
    hint: '上游 5xx。稍后重试；持续出现请查上游状态。' },
  'storage-quota': { category: 'storage', severity: 'error', surface: 'modal', title: '本地存储已满', retryable: false,
    hint: 'wx.storage 配额不足。清理会话/图片后重试。' },
  'vfs-access': { category: 'vfs', severity: 'error', surface: 'modal', title: '文件系统访问被拒', retryable: false },
  'vfs-integrity': { category: 'vfs', severity: 'error', surface: 'modal', title: '文件校验失败', retryable: true },
  'permission-denied': { category: 'permission', severity: 'warn', surface: 'toast', title: '权限不足', retryable: false,
    hint: '当前权限为仅可查看。切换权限档后再试。' },
  'session-missing': { category: 'session', severity: 'error', surface: 'modal', title: '会话不存在', retryable: false },
  'session-busy': { category: 'session', severity: 'warn', surface: 'toast', title: '会话仍在运行', retryable: true },
  'route-config': { category: 'route', severity: 'error', surface: 'modal', title: '路由配置错误', retryable: false,
    hint: 'localRuntimeRoute 或 dev-config 配置不完整。请检查设置。' },
  'tool-call-failed': { category: 'tool', severity: 'warn', surface: 'silent', title: '工具执行失败', retryable: true },
  'unknown-error': { category: 'unknown', severity: 'error', surface: 'modal', title: '未知错误', retryable: true },
}

const CODE_TABLE: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /cancelled|已停止|abort/i, code: 'cancelled' },
  { pattern: /ticket-required|ticket required/i, code: 'ticket-required' },
  { pattern: /image-resolve-failed/i, code: 'image-resolve-failed' },
  { pattern: /kernel-unavailable|kernel 分包不可加载/i, code: 'kernel-unavailable' },
  { pattern: /claim-denied|fenced|写者冲突/i, code: 'fenced' },
  { pattern: /step-exhausted|步数耗尽/i, code: 'step-exhausted' },
  { pattern: /killed|被中断/i, code: 'killed' },
  { pattern: /pump-error/i, code: 'pump-error' },
  { pattern: /read-only-path|unsafe-workspace-path|path-not-found/i, code: 'vfs-access' },
  { pattern: /hash-mismatch|bytes-missing|sha256|校验/i, code: 'vfs-integrity' },
  { pattern: /permission-denied/i, code: 'permission-denied' },
  { pattern: /tool-call-failed|tool-requires-local-vfs/i, code: 'tool-call-failed' },
  { pattern: /会话不存在|not found.*session|session.*missing/i, code: 'session-missing' },
  { pattern: /仍在运行|still running/i, code: 'session-busy' },
  { pattern: /路由解析失败|route|localRuntimeRoute|缺少 upstreamBaseUrl/i, code: 'route-config' },
  { pattern: /quota|setStorageSync|存储|exceed.*size/i, code: 'storage-quota' },
  { pattern: /timed?\s*out|timeout|超时/i, code: 'network-timeout' },
  { pattern: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|socket|request:fail|网络|offline|不可达|连接失败|NetworkError/i, code: 'network-error' },
  { pattern: /image|图片/i, code: 'image-resolve-failed' },
]

/** 从 message 里抽取 http status（`io.llm upstream 503`、`state/get 401`、`status=413` 等真实形状）。 */
function httpStatusOf(message: string): number | undefined {
  const m = /\b([1-5]\d\d)\b/.exec(message)
  if (m === null) return undefined
  const n = Number(m[1])
  return n >= 100 && n <= 599 ? n : undefined
}

function taxonFor(code: string, message: string): { code: string; taxon: Taxon; status?: number } {
  const known = TAXONOMY[code]
  if (known !== undefined) return { code, taxon: known }
  // message 启发式：先走 code 表（真实码面），再走 http status 抽取。
  for (const row of CODE_TABLE) {
    if (row.pattern.test(code) || row.pattern.test(message)) {
      return { code: row.code, taxon: TAXONOMY[row.code] ?? TAXONOMY['unknown-error'] }
    }
  }
  const status = httpStatusOf(message) ?? httpStatusOf(code)
  if (status !== undefined) {
    if (status === 401 || status === 403) return { code: `upstream-${status}`, taxon: TAXONOMY['upstream-auth'], status }
    if (status === 429 || status === 408) return { code: `upstream-${status}`, taxon: TAXONOMY['rate-limit'], status }
    if (status >= 500) return { code: `upstream-${status}`, taxon: TAXONOMY['upstream-5xx'], status }
    if (status >= 400) return { code: `upstream-${status}`, taxon: TAXONOMY['upstream-4xx'], status }
  }
  return { code: code.length > 0 ? code : 'unknown-error', taxon: TAXONOMY['unknown-error'] }
}

export interface ClassifyInput {
  code?: string
  message?: string
  retryable?: boolean
}

/** 任何错误形态 → ErrorReport。LocalEvent error 直传 code；Error/字符串走启发式。 */
export function classifyError(input: unknown, ctx: ErrorDiagnostics = {}): ErrorReport {
  let code = ''
  let message = ''
  let retryable: boolean | undefined = ctx.retryable
  let stack: string | undefined
  if (input !== null && typeof input === 'object' && 'type' in (input as Record<string, unknown>)) {
    // LocalEvent error 形状 {type:'error',code,message,retryable}
    const e = input as ClassifyInput
    code = typeof e.code === 'string' ? e.code : ''
    message = typeof e.message === 'string' ? e.message : ''
    retryable = e.retryable ?? retryable
  } else if (input instanceof Error) {
    message = input.message
    stack = input.stack
    code = codeOf(input)
  } else if (typeof input === 'string') {
    message = input
  } else if (input !== null && typeof input === 'object') {
    const row = input as ClassifyInput & { stack?: string }
    code = typeof row.code === 'string' ? row.code : ''
    message = typeof row.message === 'string' ? row.message : JSON.stringify(input)
    stack = typeof row.stack === 'string' ? row.stack : undefined
    retryable = row.retryable ?? retryable
  } else {
    message = String(input)
  }
  const { code: finalCode, taxon, status } = taxonFor(code, message)
  return {
    id: randomId('err'),
    code: finalCode,
    category: taxon.category,
    severity: taxon.severity,
    surface: taxon.surface,
    title: taxon.title,
    message: message.length > 0 ? message : taxon.title,
    hint: taxon.hint,
    diagnostics: {
      ...ctx,
      ...(status !== undefined ? { status } : {}),
      retryable: retryable ?? taxon.retryable,
      ...(stack !== undefined ? { stack } : {}),
    },
    ts: Date.now(),
    count: 1,
  }
}

/** Error 上可选携带的 code 字段（服务层抛出时附带）。 */
function codeOf(e: Error): string {
  const c = (e as Error & { code?: unknown }).code
  return typeof c === 'string' ? c : ''
}

/** 复制全文：modal「复制错误全文」与诊断 bundle 共用同一份渲染。 */
export function reportText(report: ErrorReport): string {
  const d = report.diagnostics
  const rows: Array<[string, unknown]> = [
    ['code', report.code], ['category', report.category], ['severity', report.severity],
    ['title', report.title], ['message', report.message], ['op', d.op], ['lane', d.lane],
    ['route', d.route], ['model', d.model], ['sessionId', d.sessionId], ['url', d.url],
    ['status', d.status], ['retryable', d.retryable], ['count', report.count],
    ['ts', new Date(report.ts).toISOString()],
  ]
  const lines = rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${String(v)}`)
  if (report.hint !== undefined) lines.push(`hint: ${report.hint}`)
  if (d.detail !== undefined) lines.push('', 'detail:', d.detail)
  if (d.stack !== undefined) lines.push('', 'stack:', d.stack)
  return `[dsh-mini error-report]\n${lines.join('\n')}`
}

// ── errorBus ─────────────────────────────────────────────────────────────

const LOG_CAP = 64
const TOAST_CAP = 3
const DEDUPE_MS = 1500

export interface ErrorBusState {
  toasts: ErrorReport[]
  modal?: ErrorReport
  pendingCount: number
}

type BusListener = (state: ErrorBusState) => void

class ErrorBus {
  private toasts: ErrorReport[] = []
  private toastQueue: ErrorReport[] = []
  private modalActive: ErrorReport | undefined
  private modalQueue: ErrorReport[] = []
  private readonly log: ErrorReport[] = []
  private readonly listeners = new Set<BusListener>()

  report(input: unknown, ctx: ErrorDiagnostics = {}): ErrorReport {
    const report = input !== null && typeof input === 'object' && 'diagnostics' in (input as Record<string, unknown>)
      ? input as ErrorReport
      : classifyError(input, ctx)
    // dedupe 同窗：同 code+sessionId 且未关闭 → 计数合并不重复弹。
    const peer = this.findOpen(report.code, report.diagnostics.sessionId)
    if (peer !== undefined && report.ts - peer.ts < DEDUPE_MS) {
      peer.count += 1
      peer.ts = report.ts
      this.bumpLog(peer)
      this.publish()
      return peer
    }
    this.pushLog(report)
    if (report.surface === 'toast') {
      if (this.toasts.length < TOAST_CAP) this.toasts.push(report)
      else this.toastQueue.push(report)
    } else if (report.surface === 'modal') {
      if (this.modalActive === undefined) this.modalActive = report
      else this.modalQueue.push(report)
    }
    // silent → 仅 log（诊断聚合面，不弹）。
    this.publish()
    return report
  }

  /** toast 手动关/自动关；modal 手动关→提拔队列下一个。 */
  dismiss(id: string): void {
    const ti = this.toasts.findIndex((r) => r.id === id)
    if (ti !== -1) {
      this.toasts.splice(ti, 1)
      const next = this.toastQueue.shift()
      if (next !== undefined) this.toasts.push(next)
      this.publish()
      return
    }
    const qi = this.toastQueue.findIndex((r) => r.id === id)
    if (qi !== -1) {
      this.toastQueue.splice(qi, 1)
      this.publish()
      return
    }
    if (this.modalActive?.id === id) {
      this.modalActive = this.modalQueue.shift()
      this.publish()
      return
    }
    const mi = this.modalQueue.findIndex((r) => r.id === id)
    if (mi !== -1) {
      this.modalQueue.splice(mi, 1)
      this.publish()
    }
  }

  /** toast「详情」升 modal：从 toast 面摘除并入 modal 队列头。 */
  openDetail(id: string): void {
    const ti = this.toasts.findIndex((r) => r.id === id)
    if (ti === -1) return
    const [report] = this.toasts.splice(ti, 1)
    const next = this.toastQueue.shift()
    if (next !== undefined) this.toasts.push(next)
    if (this.modalActive === undefined) this.modalActive = report
    else this.modalQueue.unshift(report)
    this.publish()
  }

  recent(limit = 20): ErrorReport[] {
    return this.log.slice(-limit)
  }

  state(): ErrorBusState {
    return {
      toasts: [...this.toasts],
      modal: this.modalActive,
      pendingCount: this.toastQueue.length + this.modalQueue.length,
    }
  }

  subscribe(listener: BusListener): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.toasts = []
    this.toastQueue = []
    this.modalActive = undefined
    this.modalQueue = []
    this.publish()
  }

  private findOpen(code: string, sessionId: string | undefined): ErrorReport | undefined {
    const match = (r: ErrorReport | undefined) => r !== undefined && r.code === code && r.diagnostics.sessionId === sessionId
    return this.toasts.find(match) ?? this.toastQueue.find(match) ?? (match(this.modalActive) ? this.modalActive : undefined) ?? this.modalQueue.find(match)
  }

  private pushLog(report: ErrorReport): void {
    this.log.push(report)
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP)
  }

  /** 合并后的 report 在 log 中原位更新（count/ts 前移不改序）。 */
  private bumpLog(report: ErrorReport): void {
    const i = this.log.findIndex((r) => r.id === report.id)
    if (i !== -1) this.log[i] = report
  }

  private publish(): void {
    const s = this.state()
    for (const listener of this.listeners) {
      try { listener(s) } catch (e) { console.warn('[error-bus] listener 抛错:', e instanceof Error ? e.message : e) }
    }
  }
}

export const errorBus = new ErrorBus()
