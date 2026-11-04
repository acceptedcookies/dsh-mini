/**
 * local-runtime 路由旋钮解析。
 * 真源：app.json["dsh"].localRuntimeRoute ∈ local | cloud | cloud-sim（CommonJS require 读取）；
 * fallback：dev-config.ts 内生成时镜像的 route 字段。
 */
declare const require: (path: string) => unknown

export type RouteMode = 'local' | 'cloud' | 'cloud-sim'

export interface RouteConfig {
  mode: RouteMode
  /** 数据面代理 base（cloud/sim 模式下 fx provider 的 base_url 被改写为它）。
   *  cloud 容器车道时为 `container://{service}` 伪协议标记（io.llm 识别走 callContainer）。 */
  proxyBaseUrl?: string
  /** sim 控制面 base（challenge/enroll/unlock/revoke）。 */
  simBaseUrl?: string
  /** 真云 env_id（wx.cloud.init 默认 env——callFunction 控制面/DB 所在）。 */
  cloudEnvId?: string
  /** callContainer 目标 env（config.env；容器与函数分属不同 env 时按调用指定，缺省=cloudEnvId）。 */
  containerEnvId?: string
  /** callContainer 车道：服务名（X-WX-SERVICE）。 */
  cloudService?: string
}

interface RouteSource {
  route?: RouteMode
  sim?: { baseUrl?: string }
  cloud?: { envId?: string; containerEnvId?: string; proxyUrl?: string; service?: string }
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
    const service = devConfig.cloud?.service
    if (service !== undefined && service.length > 0) {
      // 容器车道（首选）：wx.cloud.callContainer 内网直连，免公网域名/合法域名
      return {
        mode,
        proxyBaseUrl: `container://${service}`,
        cloudEnvId: devConfig.cloud?.envId,
        containerEnvId: devConfig.cloud?.containerEnvId || devConfig.cloud?.envId,
        cloudService: service,
      }
    }
    const proxyUrl = devConfig.cloud?.proxyUrl
    if (proxyUrl === undefined || proxyUrl.length === 0) {
      throw new Error('cloud 路由需要 cloud.service（callContainer）或 cloud.proxy_url（公网 https），见 cloud/README.md')
    }
    return { mode, proxyBaseUrl: proxyUrl, cloudEnvId: devConfig.cloud?.envId }
  }
  if (mode === 'cloud-sim') {
    const base = devConfig.sim?.baseUrl ?? 'http://127.0.0.1:3426'
    return { mode, proxyBaseUrl: base, simBaseUrl: base }
  }
  return { mode: 'local' }
}
