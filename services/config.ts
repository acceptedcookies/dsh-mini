export const APP_NAME = 'dsh'
export const APP_VERSION = '0.3.0'
export const APP_ID = 'wx356d3abb52825466'

/** nano-agent orchestrator used by the native client when the owner signs in. */
export const NANO_BASE_URL = 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev'
export const NANO_WS_BASE_URL = 'wss://nano-agent-orchestrator-core-preview.haimang.workers.dev'

export interface ModelOption {
  id: string
  label: string
  description: string
}

/** 支持规模按业主裁决收敛为两款 DeepSeek（magpie 路由 id，直接作为 FX_MODEL/注入模型）。 */
export const MODELS: ModelOption[] = [
  { id: 'workbuddy/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', description: '默认 · 快速响应' },
  { id: 'workbuddy/deepseek-v4-pro', label: 'DeepSeek V4.1 Pro', description: '更强推理 · 复杂任务' },
]

export const DEFAULT_MODEL = MODELS[0]?.id ?? 'workbuddy/deepseek-v4.1-flash'
