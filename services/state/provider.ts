/**
 * provider —— io.state 车道裁决（MN02 §0.2.6 kernel 远程 durable lane）。
 * cloud 路由 → remoteCas（POD1 fss3 五端点，unlock 票据，oid 服务端注入）；
 * local/cloud-sim → localCas（sim 票据 secret 与 POD1 不同源，不上线——诚实降级）。
 *
 * 无静默回退：远端故障真实上抛（remoteCas 对非 2xx throw），不偷偷写本地充数。
 * owner='self' 是客户端占位标签：线键上 owner 段由服务端以票据 oid 重写，
 * 泵内 full key 与线键的往返映射自洽即可（remote-cas wire/unwire 注释）。
 */
import { localCas } from './local-cas'
import { createRemoteCas } from './remote-cas'
import { createTicketProvider } from '../fx/ticket'
import { loadDevConfig, currentRoute } from '../fx/dev'
import { readEnrollment } from '../fx/enrollment'
import { DSH_MINI_BASE_URL } from '../config'
import type { IoState } from '../nano-mini-host/types'

let cachedRemote: IoState | undefined

/** 远程 durable lane 开关（storage 调试旋钮，默认跟路由）。 */
export function remoteDurableEnabled(): boolean {
  const v = wx.getStorageSync('dsh:mini:remote-durable') as boolean | '' | undefined
  if (typeof v === 'boolean') return v
  return currentRoute().mode === 'cloud'
}

export function ioStateFor(): IoState {
  const route = currentRoute()
  if (route.mode !== 'cloud' || !remoteDurableEnabled()) return localCas
  if (cachedRemote !== undefined) return cachedRemote
  const cfg = loadDevConfig()
  const enrollment = readEnrollment()
  const durableBase = (cfg?.cloud.durableUrl ?? '') !== '' ? cfg!.cloud.durableUrl! : DSH_MINI_BASE_URL
  const ticket = createTicketProvider(route, {
    providerName: cfg?.providerName ?? enrollment?.provider ?? 'byok',
    upstreamBaseUrl: cfg?.upstreamBaseUrl ?? enrollment?.upstreamBaseUrl ?? '',
    providerApiKey: cfg?.providerApiKey ?? '',
    model: enrollment?.model ?? 'unknown',
    allowedModels: cfg?.allowedModels,
    sim: cfg?.sim ?? { baseUrl: 'http://127.0.0.1:3426' },
    cloud: cfg?.cloud ?? { envId: route.cloudEnvId ?? '', proxyUrl: route.proxyBaseUrl ?? '', durableUrl: durableBase },
  })
  cachedRemote = createRemoteCas({
    baseUrl: durableBase,
    owner: 'self',
    headers: () => ticket.authHeaders(durableBase),
  })
  return cachedRemote
}
