import type { SessionEngine } from '../types/protocol'

export const APP_NAME = 'dsh'
export const APP_VERSION = '0.3.0'
export const APP_ID = 'wx356d3abb52825466'

/** nano-agent orchestrator used by the native client when the owner signs in. */
export const NANO_BASE_URL = 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev'
export const NANO_WS_BASE_URL = 'wss://nano-agent-orchestrator-core-preview.haimang.workers.dev'

/** FRD1 durable 生产入口（S3-first 单合同；票据=真云 unlock 同 secret 签发）。 */
export const DSH_MINI_BASE_URL = 'https://dsh-mini.saobao.com'

/** 工具公网出栈的唯一名单。container:// 不走这里。 */
export const EGRESS_ALLOWLIST = {
  allowed_domains: [
    'nano-agent-orchestrator-core-preview.haimang.workers.dev',
    'dsh-mini.saobao.com',
  ],
  allowed_ports: [443] as const,
  allow_private_ip: false,
}

/** 手写解析：小程序 JSC 不保证有 URL 构造器。 */
function parseTarget(target: string): { protocol: string; host: string; port: number } | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(target)
  if (match === null) return null
  const protocol = match[1].toLowerCase()
  let authority = match[2]
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = authority.slice(at + 1)
  let host = ''
  let portText = ''
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0) return null
    host = authority.slice(1, end)
    const rest = authority.slice(end + 1)
    if (rest.startsWith(':')) portText = rest.slice(1)
  } else {
    const idx = authority.lastIndexOf(':')
    if (idx >= 0 && authority.indexOf(':') === idx) {
      host = authority.slice(0, idx)
      portText = authority.slice(idx + 1)
    } else {
      host = authority
    }
  }
  const defaultPort = protocol === 'https' ? 443 : protocol === 'http' ? 80 : 0
  const port = portText === '' ? defaultPort : Number(portText)
  if (!Number.isFinite(port)) return null
  return { protocol, host: host.toLowerCase(), port }
}

export function egressDecision(target: string): { ok: true } | { ok: false; code: 'egress-denied'; reason: string } {
  if (target.startsWith('container://')) return { ok: true }
  const parsed = parseTarget(target)
  if (parsed === null) return { ok: false, code: 'egress-denied', reason: 'egress-denied host=invalid' }
  const { protocol, host, port } = parsed
  if (protocol !== 'https') return { ok: false, code: 'egress-denied', reason: `egress-denied host=${host}` }
  const privateIp = host === 'localhost'
    || host === '::1'
    || host.startsWith('127.')
    || host.startsWith('10.')
    || host.startsWith('192.168.')
    || host.startsWith('169.254.')
    || host.startsWith('fe80:')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  if (!EGRESS_ALLOWLIST.allow_private_ip && privateIp) {
    return { ok: false, code: 'egress-denied', reason: `egress-denied host=${host}` }
  }
  if (!(EGRESS_ALLOWLIST.allowed_ports as readonly number[]).includes(port)) {
    return { ok: false, code: 'egress-denied', reason: `egress-denied host=${host}` }
  }
  const allowed = EGRESS_ALLOWLIST.allowed_domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  if (!allowed) return { ok: false, code: 'egress-denied', reason: `egress-denied host=${host}` }
  return { ok: true }
}

export interface ModelOption {
  id: string
  label: string
  description: string
  /** 引擎白名单：模型 id 只在这些引擎车道生效——选择器与生效模型归一都按
   *  它过滤（业主 MN04：BYOK 会话不得出现 magpie 模型，反之亦然）。 */
  engines: SessionEngine[]
}

/** 支持规模按业主裁决收敛为两款 DeepSeek（magpie 路由 id，直接作为 FX_MODEL/注入模型）。
 *  `deepseek-flash` 为真云 BYOK 车道 id——须与云端 ALLOWED_MODELS 白名单同值。 */
export const MODELS: ModelOption[] = [
  { id: 'workbuddy/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', description: '默认 · 快速响应', engines: ['magpie'] },
  { id: 'workbuddy/deepseek-v4-pro', label: 'DeepSeek V4.1 Pro', description: '更强推理 · 复杂任务', engines: ['magpie'] },
  { id: 'deepseek-flash', label: 'DeepSeek Flash', description: '云端 BYOK · deepseek.com 直连', engines: ['nano-agent', 'cloud'] },
]

export const DEFAULT_MODEL = MODELS[0]?.id ?? 'workbuddy/deepseek-v4.1-flash'

/** 引擎面模型列表：无白名单命中的引擎回落全表（防御，正常不发生）。 */
export function modelsForEngine(engine: SessionEngine): ModelOption[] {
  const list = MODELS.filter((m) => m.engines.includes(engine))
  return list.length > 0 ? list : MODELS
}

/** 引擎默认模型：选择不在白名单/无选择时的回落点（BYOK→deepseek-flash，
 *  magpie→v4.1-flash）。全局 DEFAULT_MODEL 只作无引擎语境兜底。 */
export function defaultModelFor(engine: SessionEngine): string {
  return modelsForEngine(engine)[0]?.id ?? DEFAULT_MODEL
}
