/**
 * callContainer 数据面通道（cloud 容器车道）：
 * `container://{service}/v1/...` 伪 URL → wx.cloud.callContainer。
 * 内网直连云托管，免公网域名/合法域名；与 wx.request HTTP 车道同 response 语义。
 * 无 wx.cloud 宿主（Node 测试）时抛错——由调用方决定是否降级。
 */

interface WxCloudContainer {
  init(opts: { env?: string }): void
  callContainer(o: {
    config: { env: string }
    path: string
    header: Record<string, string>
    method: string
    data?: unknown
    success?: (r: { statusCode: number; data: unknown }) => void
    fail?: (e: { errMsg?: string }) => void
  }): void
}

let containerInited = false

function cloudApi(): WxCloudContainer | undefined {
  return (wx as unknown as { cloud?: WxCloudContainer }).cloud
}

export function isContainerUrl(url: string): boolean {
  return url.startsWith('container://')
}

/** container://service/path → { service, path }（path 含前导 /，缺省 /）。 */
export function parseContainerUrl(url: string): { service: string; path: string } {
  const rest = url.slice('container://'.length)
  const i = rest.indexOf('/')
  return i === -1 ? { service: rest, path: '/' } : { service: rest.slice(0, i), path: rest.slice(i) }
}

export interface ContainerResponse {
  status: number
  body: unknown
}

/**
 * @param targetEnv 容器所在 env（config.env，可与 init env 不同——双 env 拓扑下容器
 *                  与函数/DB 分属不同云环境时必须按调用指定）
 * @param initEnv   wx.cloud.init 默认 env（函数/DB 所在；一次 init 全局生效）
 */
export function callContainer(
  targetEnv: string,
  initEnv: string,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown },
): Promise<ContainerResponse> {
  const api = cloudApi()
  if (api === undefined) return Promise.reject(new Error('wx.cloud.callContainer 不可用（需云开发基础库/Node 宿主不支持）'))
  if (!containerInited) {
    containerInited = true
    api.init({ env: initEnv })
  }
  const { service, path } = parseContainerUrl(url)
  return new Promise((resolve, reject) => {
    api.callContainer({
      config: { env: targetEnv.length > 0 ? targetEnv : initEnv },
      path,
      header: { 'X-WX-SERVICE': service, ...init.headers },
      method: init.method,
      data: init.body,
      success: (r) => resolve({ status: r.statusCode, body: r.data }),
      fail: (e) => reject(new Error(`callContainer ${service}${path} → ${e.errMsg ?? 'failed'}`)),
    })
  })
}
