/**
 * local-runtime 路由旋钮解析。
 * 真源：app.json["dsh"].localRuntimeRoute ∈ local | cloud | cloud-sim（CommonJS require 读取）；
 * fallback：dev-config.ts 内生成时镜像的 route 字段。
 */
declare const require: (path: string) => unknown

export type RouteMode = 'local' | 'cloud' | 'cloud-sim'

export interface RouteConfig {
  mode: RouteMode
  /** 数据面代理 base（cloud/sim 模式下 fx provider 的 base_url 被改写为它）。 */
  proxyBaseUrl?: string
  /** sim 控制面 base（challenge/enroll/unlock/revoke）。 */
  simBaseUrl?: string
  /** 真云 env_id（wx.cloud.init）。 */
  cloudEnvId?: string
}

interface RouteSource {
  route?: RouteMode
  sim?: { baseUrl?: string }
  cloud?: { envId?: string; proxyUrl?: string }
}

const MODES: readonly RouteMode[] = ['local', 'cloud', 'cloud-sim']

function knobFromAppJson(): RouteMode | undefined {
  try {
    const appJson = require('../../app.json') as { dsh?: { localRuntimeRoute?: string } }
    const v = appJson?.dsh?.localRuntimeRoute
    return (MODES as readonly string[]).includes(v ?? '') ? (v as RouteMode) : undefined
  } catch {
    return undefined
  }
}

export function resolveRoute(devConfig: RouteSource): RouteConfig {
  const mode = knobFromAppJson() ?? devConfig.route ?? 'local'
  if (mode === 'cloud') {
    const proxyUrl = devConfig.cloud?.proxyUrl
    if (proxyUrl === undefined || proxyUrl.length === 0) {
      throw new Error('cloud 路由需要 .local.development.json cloud.proxy_url（云托管地址），见 cloud/README.md')
    }
    return { mode, proxyBaseUrl: proxyUrl, cloudEnvId: devConfig.cloud?.envId }
  }
  if (mode === 'cloud-sim') {
    const base = devConfig.sim?.baseUrl ?? 'http://127.0.0.1:3426'
    return { mode, proxyBaseUrl: base, simBaseUrl: base }
  }
  return { mode: 'local' }
}
