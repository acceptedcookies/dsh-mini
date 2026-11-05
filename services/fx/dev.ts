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
  cloud: { envId: string; containerEnvId?: string; proxyUrl: string; service?: string; durableUrl?: string }
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

let routeErr: Error | undefined

export function currentRoute(): RouteConfig {
  const cfg = loadDevConfig()
  try {
    // cfg 缺席也走 resolveRoute——app.json 旋钮真源在 resolveRoute 内读取，
    // 提前 local 兜底会让 cloud 旋钮在配置缺失时静默失效（UI 审查 F10）。
    const r = resolveRoute(cfg ?? {})
    routeErr = undefined
    return r
  } catch (e) {
    // 兜底仍 local 但错误在案——设置页经 lastRouteError 如实显示，
    // 不再把「cloud 配置坏」静默呈现成「本地直连」（UI 审查 F10）。
    routeErr = e instanceof Error ? e : new Error(String(e))
    console.warn('[dev] 路由解析失败按 local 兜底:', routeErr.message)
    return { mode: 'local' }
  }
}

/** 最近一次路由解析错误（无错/未解析→undefined）——设置页如实显示用。 */
export function lastRouteError(): Error | undefined {
  return routeErr
}
