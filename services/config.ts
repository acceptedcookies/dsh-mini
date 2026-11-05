import type { SessionEngine } from '../types/protocol'

export const APP_NAME = 'dsh'
export const APP_VERSION = '0.3.0'
export const APP_ID = 'wx356d3abb52825466'

/** nano-agent orchestrator used by the native client when the owner signs in. */
export const NANO_BASE_URL = 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev'
export const NANO_WS_BASE_URL = 'wss://nano-agent-orchestrator-core-preview.haimang.workers.dev'

/** POD1 durable 基座公网入口（fss3 收窄 API 面；票据=真云 unlock 同 secret 签发）。 */
export const DSH_MINI_BASE_URL = 'https://dsh-mini.haimang.com.cn'

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
