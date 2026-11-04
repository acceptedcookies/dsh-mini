/**
 * dev-config 装载与路由解析的共享入口（runtime 与设置页共用，避免各自 require 生成物）。
 */
import { resolveRoute, type RouteConfig } from './route'

declare const require: (path: string) => unknown

export interface DevConfig {
  wasmPath: string
  providerName: string
  baseUrl: string
  model: string
  route: 'local' | 'cloud' | 'cloud-sim'
  sim: { baseUrl: string }
  cloud: { envId: string; proxyUrl: string; service?: string }
  providerApiKey: string
  upstreamBaseUrl: string
  allowedModels: string[]
  modelMeta: Record<string, { context_window: number; supports_tool_use: boolean; supports_vision: boolean }>
  fxEnv: Record<string, string>
}

let cached: DevConfig | undefined
let loaded = false

export function loadDevConfig(): DevConfig | undefined {
  if (!loaded) {
    loaded = true
    try {
      cached = require('./dev-config') as DevConfig
    } catch {
      cached = undefined
    }
  }
  return cached
}

export function currentRoute(): RouteConfig {
  const cfg = loadDevConfig()
  if (cfg === undefined) return { mode: 'local' }
  try {
    return resolveRoute(cfg)
  } catch {
    return { mode: 'local' }
  }
}
