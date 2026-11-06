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
  /** VFS/远端对象路径或键（remote-sync 失败定位用）。 */
  path?: string
  key?: string
  workspace?: string
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
  'domain-not-whitelisted': {
    category: 'network', severity: 'error', surface: 'modal', title: '请求域名未白名单', retryable: false,
    hint: '真机/预览版强制校验合法域名。请在 mp.weixin.qq.com → 开发管理 → 服务器域名，把诊断 url 的域名加入 request 合法域名（socket/uploadFile/downloadFile 各有独立表）。',
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
  'alarm-abandoned': { category: 'runtime', severity: 'warn', surface: 'toast', title: '后台恢复放弃', retryable: false,
    hint: '挂起的轮次多次恢复失败已止损。重新发送消息可重新开始。' },
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

/** SPECIFIC 表先行：domain 锚定词（不与 http status/自由文本碰撞）。
 *  GENERIC 表后置：status 抽取之后——'upstream 503 aborted' 里的 abort/timeout
 *  属上游返回体内容，不得抢分类（审查 MN03-R1：真错误曾被 abort→cancelled 静默）。 */
const SPECIFIC_TABLE: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /not in domain list|domain list|合法域名/i, code: 'domain-not-whitelisted' },
  { pattern: /ticket-required|ticket required/i, code: 'ticket-required' },
  { pattern: /image-resolve-failed/i, code: 'image-resolve-failed' },
  { pattern: /kernel-unavailable|kernel 分包不可加载/i, code: 'kernel-unavailable' },
  { pattern: /claim-denied|fenced|写者冲突/i, code: 'fenced' },
  { pattern: /step-exhausted|步数耗尽/i, code: 'step-exhausted' },
  { pattern: /pump-error/i, code: 'pump-error' },
  { pattern: /read-only-path|unsafe-workspace-path|path-not-found/i, code: 'vfs-access' },
  { pattern: /hash-mismatch|bytes-missing|sha256|校验/i, code: 'vfs-integrity' },
  { pattern: /permission-denied/i, code: 'permission-denied' },
  { pattern: /tool-call-failed|tool-requires-local-vfs/i, code: 'tool-call-failed' },
  { pattern: /会话不存在|not found.*session|session.*missing/i, code: 'session-missing' },
  { pattern: /仍在运行|still running/i, code: 'session-busy' },
  { pattern: /localRuntimeRoute|路由解析失败|缺少 upstreamBaseUrl|route-config|wx\.cloud 不可用|云开发基础库|callContainer 不可用/i, code: 'route-config' },
  // wx errMsg/存储词锚定在 SPECIFIC（status 之前）；裸 quota/size 在 GENERIC
  // （status 之后）——上游 429/402 body 'insufficient_quota/quota exceeded'
  // 须先归 rate-limit/upstream，不得被 quota 抢成「本地存储已满」（MN03-R2 C-1）。
  { pattern: /setStorageSync|存储配额|本地存储/i, code: 'storage-quota' },
  { pattern: /alarm.*(abandon|放弃)|重臂.*放弃|alarm-abandoned/i, code: 'alarm-abandoned' },
]

const GENERIC_TABLE: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /cancelled|已停止|^request:fail abort|user cancell?ed|\babort(ed)?\b/i, code: 'cancelled' },
  { pattern: /timed?\s*out|timeout|超时/i, code: 'network-timeout' },
  { pattern: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|EHOSTUNREACH|no route to host|fetch failed|socket|request:fail|网络|offline|不可达|连接失败|NetworkError/i, code: 'network-error' },
  { pattern: /killed|被中断/i, code: 'killed' },
  { pattern: /image|图片/i, code: 'image-resolve-failed' },
  // 上游配额措辞（OpenAI 兼容面 'insufficient_quota'/'quota exceeded' 无 status
  // 裸入时）→rate-limit 语义；裸 'quota'/'exceed size' 才落本地存储面（MN03-R3）。
  { pattern: /insufficient_quota|quota exceeded/i, code: 'rate-limit' },
  { pattern: /quota|exceed.*size/i, code: 'storage-quota' },
]

/** 从 message 里抽取 http status。三段防御（MN03-R2 C-2 / R3 单位词假阳）：
 *  ①锚定上下文 `upstream|status|http`——'io.llm upstream 503'/'status=413'/'status":503' 真形状；
 *  ②裸三位但排除 `:` 前缀——`127.0.0.1:443` 端口不误归 upstream-443；
 *  ③单位词后缀跳过——'retry in 500 ms'/'upload 500 files'/'batch 404 items' 非 status。 */
function httpStatusOf(message: string): number | undefined {
  const anchored = /(?:upstream|status|http)\s*[=:"]?\s*([1-5]\d\d)/i.exec(message)
  if (anchored !== null) return Number(anchored[1])
  // 字符类须 BMP 手写——真机 JSC 不支持 \p{L}\p{N} Unicode 属性转义（W3 真机实测
  // 整个 classifyError 在 RegExp 构造即 SyntaxError，errorBus 全链崩坏）。
  for (const m of message.matchAll(/(^|[\s=(,])([1-5]\d\d)\b\s*([0-9A-Za-zÀ-ɏ぀-ヿ㐀-䶿一-鿿豈-﫿%]*)/gu)) {
    const suffix = m[3] ?? ''
    // latin 全等（防 '500 server'/'500 killed' 前缀误伤）；CJK 前缀匹配
    // （'500 次后放弃'/'500 个文件' 复合词中单位在词首，MN03-R4 N1）。
    if (/^(ms|s|sec|seconds?|min|minutes?|px|pixels?|k|kb|mb|gb|bytes?|files?|items?|rows?|lines?|tokens?|records?|entries?)$/i.test(suffix)) continue
    if (/^(个|条|字节|行|次|秒|分|块|位|页|帧|层|项|篇|部|张|句|词|字)/.test(suffix)) continue
    return Number(m[2])
  }
  return undefined
}

/** HTML 响应体净化（nginx/CF 错误页嵌进 message 的形状 '… upstream 503: "<html>\r\n…"'）：
 *  展示面剥标签、优先取 <title> 摘要；原始体移交 diagnostics.detail——
 *  modal 滚动区与复制全文仍带全量，正文不再被 HTML 撑爆（W3 真机 503 实录）。 */
function sanitizeDisplay(message: string): { display: string; raw?: string } {
  const htmlAt = message.search(/<(?:html|head|body|title|div|center|h[1-6]|p|pre|table|span)\b/i)
  if (htmlAt === -1) return { display: message }
  const prefix = message.slice(0, htmlAt).replace(/["'\s]+$/, '')
  const tail = message.slice(htmlAt)
  const title = /<title>([^<]+)<\/title>/i.exec(tail)?.[1]
  const stripped = tail
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\[rnt]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  const summary = (title?.trim() ?? '').length > 0 ? title!.trim() : stripped
  const display = summary.length > 0 ? `${prefix} ${summary}` : prefix
  return { display: display.slice(0, 400), raw: message }
}

/** 包装码（pump/host 兜底层）——其 message 内的真上游/域错误身份优先于壳码
 *  （MN03-B9 实证：'host-error: io.llm upstream 404' 若停在壳码，'运行错误'
 *  通用弹窗吞掉上游 404 语义；让位后呈 upstream-404 专属面）。 */
const WRAPPER_CODES = new Set(['host-error', 'turn_failed', 'pump-error', 'image-resolve-failed'])

function taxonFor(code: string, message: string, objStatus?: number): { code: string; taxon: Taxon; status?: number } {
  const known = TAXONOMY[code]
  const isWrapper = WRAPPER_CODES.has(code)
  // 序：已知 taxonomy 码 → domain 锚定 → http status（≥400 才抢分类）→ 自由文本。
  // 已知码短路也补 status 抽取——诊断面如实记 message 内嵌的上游状态（MN03-B9）。
  if (known !== undefined && !isWrapper) {
    return { code, taxon: known, status: objStatus ?? httpStatusOf(message) }
  }
  // 包装码在 SPECIFIC 循环只测 message 不测 code——壳码若自匹配某 SPECIFIC 行
  // （如 pump-error），让位会被自身短路吞掉（MN03-R5 nit）。
  for (const row of SPECIFIC_TABLE) {
    if ((!isWrapper && row.pattern.test(code)) || row.pattern.test(message)) {
      return { code: row.code, taxon: TAXONOMY[row.code] ?? TAXONOMY['unknown-error'], status: objStatus ?? httpStatusOf(message) }
    }
  }
  // 对象自带 status（NanoApiError.status 等结构化字段）优先于文本抽取（MN03-R2 C-3）。
  const status = objStatus ?? httpStatusOf(message) ?? httpStatusOf(code)
  if (status !== undefined && status >= 400) {
    if (status === 401 || status === 403) return { code: `upstream-${status}`, taxon: TAXONOMY['upstream-auth'], status }
    if (status === 429 || status === 408) return { code: `upstream-${status}`, taxon: TAXONOMY['rate-limit'], status }
    if (status >= 500) return { code: `upstream-${status}`, taxon: TAXONOMY['upstream-5xx'], status }
    return { code: `upstream-${status}`, taxon: TAXONOMY['upstream-4xx'], status }
  }
  for (const row of GENERIC_TABLE) {
    if (row.pattern.test(code) || row.pattern.test(message)) {
      return { code: row.code, taxon: TAXONOMY[row.code] ?? TAXONOMY['unknown-error'] }
    }
  }
  // 包装码无命中——回自身 known taxon（保 'host-error' 运行错误面而非掉 unknown）。
  return { code: code.length > 0 ? code : 'unknown-error', taxon: known ?? TAXONOMY['unknown-error'] }
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
  let objStatus: number | undefined
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
    // NanoApiError 等结构化 status 字段——'登录已失效'(无文本 status) 不再掉 unknown（MN03-R2 C-3）。
    const s = (input as Error & { status?: unknown }).status
    if (typeof s === 'number' && s >= 100 && s <= 599) objStatus = s
  } else if (typeof input === 'string') {
    message = input
  } else if (input !== null && typeof input === 'object') {
    // wx fail 回调形状 {errMsg:'xxx:fail ...'}——errMsg 是 wx 面的 message 等价物
    // （MN03-R3：原样 JSON.stringify 会把 {"errMsg":...} 原文呈给用户）。
    const row = input as ClassifyInput & { stack?: string; status?: unknown; errMsg?: unknown }
    code = typeof row.code === 'string' ? row.code : ''
    message = typeof row.message === 'string' ? row.message : typeof row.errMsg === 'string' ? row.errMsg : JSON.stringify(input)
    stack = typeof row.stack === 'string' ? row.stack : undefined
    retryable = row.retryable ?? retryable
    if (typeof row.status === 'number' && row.status >= 100 && row.status <= 599) objStatus = row.status
  } else {
    message = String(input)
  }
  const { code: finalCode, taxon, status } = taxonFor(code, message, objStatus)
  const cleaned = sanitizeDisplay(message)
  // message 内嵌 URL（wx.request 保真后缀 '… · https://…'）→ 诊断 url 字段——
  // 'url not in domain list' 这类错误缺 URL 时根本无法定位是哪个域（W4 实录）。
  const msgUrl = ctx.url === undefined ? /https?:\/\/[^\s·"']+/.exec(message)?.[0] : undefined
  return {
    id: randomId('err'),
    code: finalCode,
    category: taxon.category,
    severity: taxon.severity,
    surface: taxon.surface,
    title: taxon.title,
    message: cleaned.display.length > 0 ? cleaned.display : taxon.title,
    hint: taxon.hint,
    diagnostics: {
      ...ctx,
      ...(msgUrl !== undefined ? { url: msgUrl } : {}),
      ...(status !== undefined ? { status } : {}),
      retryable: retryable ?? taxon.retryable,
      ...(cleaned.raw !== undefined
        ? { detail: [ctx.detail, cleaned.raw].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n\n') }
        : {}),
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
    ['path', d.path], ['key', d.key], ['workspace', d.workspace],
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
/** 溢出队列上界——错误风暴下队尾丢新（台账仍全记），队列不炸内存（MN03-R1）。 */
const QUEUE_CAP = 16
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
    let report: ErrorReport
    try {
      report = input !== null && typeof input === 'object' && 'diagnostics' in (input as Record<string, unknown>)
        ? input as ErrorReport
        : classifyError(input, ctx)
    } catch {
      // 分类器自身故障不得向业务抛错（真机 JSC 对 \p{} 正则 SyntaxError 时
      // report 若抛出，init catch 块二次炸死→loading 永卡——W3 真机实测）。
      // 降级 unknown-error 兜底面保错误可达。
      const taxon = TAXONOMY['unknown-error']
      const raw = input instanceof Error ? input.message : typeof input === 'string' ? input : ''
      report = {
        id: randomId('err'), code: 'unknown-error', category: taxon.category,
        severity: taxon.severity, surface: taxon.surface, title: taxon.title,
        message: raw.length > 0 ? raw : taxon.title, hint: taxon.hint,
        diagnostics: { ...ctx, retryable: taxon.retryable }, ts: Date.now(), count: 1,
      }
    }
    // dedupe：同 code+sessionId 且仍开着 → 计数合并不重复弹（ts 保首现不滑窗——
    // 持续同错合并到关闭为止，不会再弹新 toast，MN03-R1 修滑动窗漂移）。
    const peer = this.findOpen(report.code, report.diagnostics.sessionId)
    if (peer !== undefined) {
      peer.count += 1
      this.bumpLog(peer)
      this.publish()
      return peer
    }
    // silent 面 dedupe：无 open surface 可扫——与最近台账同窗合并，
    // 防 tool-call-failed 高频流水把 64 行 ring buffer 冲干（MN03-R1）。
    if (report.surface === 'silent') {
      const tail = this.logTailPeer(report.code, report.diagnostics.sessionId)
      if (tail !== undefined && report.ts - tail.ts < DEDUPE_MS) {
        tail.count += 1
        this.publish()
        return tail
      }
    }
    this.pushLog(report)
    if (report.surface === 'toast') {
      if (this.toasts.length < TOAST_CAP) this.toasts.push(report)
      else if (this.toastQueue.length < QUEUE_CAP) this.toastQueue.push(report)
      // 队列满→降级 silent（已入台账，诊断可见）——风暴下不无限积压。
    } else if (report.surface === 'modal') {
      if (this.modalActive === undefined) this.modalActive = report
      else if (this.modalQueue.length < QUEUE_CAP) this.modalQueue.push(report)
      // 同上——modal 风暴降级台账。
    }
    // silent → 仅 log（诊断聚合面，不弹）。
    this.publish()
    return report
  }

  /** toast 手动关/自动关；modal 手动关→提拔队列下一个。
   *  surface 限定防同帧竞态：toast 的自动关回调不得关掉刚升舱的 modal（R1）。 */
  dismiss(id: string, surface?: 'toast' | 'modal'): void {
    if (surface !== 'modal') {
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
    }
    if (surface === 'toast') return
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

  /** toast「详情」升 modal：从 toast 面摘除并入 modal 队尾（FIFO，不抢已在队 modal）。 */
  openDetail(id: string): void {
    const ti = this.toasts.findIndex((r) => r.id === id)
    if (ti === -1) return
    const [report] = this.toasts.splice(ti, 1)
    const next = this.toastQueue.shift()
    if (next !== undefined) this.toasts.push(next)
    if (this.modalActive === undefined) this.modalActive = report
    else this.modalQueue.push(report)
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

  /** silent dedupe 面：只扫台账尾段（近 16 行）——同码同会话的连续流合并计数。 */
  private logTailPeer(code: string, sessionId: string | undefined): ErrorReport | undefined {
    const from = Math.max(0, this.log.length - 16)
    for (let i = this.log.length - 1; i >= from; i -= 1) {
      const r = this.log[i]
      if (r.code === code && r.diagnostics.sessionId === sessionId) return r
    }
    return undefined
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

/** 静默台账便捷面：分类后强制 silent 入 bus——后台/best-effort 错误面统一写法
 *  （有专属 UI 面或不弹窗语义的失败不双弹，诊断聚合仍可见，MN03-R1）。 */
export function reportSilent(input: unknown, ctx: ErrorDiagnostics = {}): ErrorReport {
  const report = classifyError(input, ctx)
  report.surface = 'silent'
  return errorBus.report(report)
}
