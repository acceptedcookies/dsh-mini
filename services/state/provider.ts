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
import { createRemoteVfs, type RemoteVfs } from '../vfs/remote'
import { createVfsSync, type VfsSync } from '../vfs/remote-sync'
import { createTicketProvider, hasFreshTicket } from '../fx/ticket'
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

let cachedTicketProvider: ReturnType<typeof createTicketProvider> | undefined
let cachedTicketKey = ''
let cachedRemoteKey = ''

/** 共享票据提供器（remoteCas / vfsRemote 同车道复用——模块级票据缓存已单飞）。
 *  输入指纹变（路由/端点/供应商）即重建——缓存不得跨配置变更存活（审查 B8）。 */
function durableTicketProvider(): { base: string; provider: ReturnType<typeof createTicketProvider>; key: string } | null {
  const route = currentRoute()
  if (route.mode !== 'cloud') return null
  const cfg = loadDevConfig()
  const enrollment = readEnrollment()
  const durableBase = (cfg?.cloud.durableUrl ?? '') !== '' ? cfg!.cloud.durableUrl! : DSH_MINI_BASE_URL
  const key = `${route.mode}|${durableBase}|${cfg?.providerName ?? ''}|${cfg?.upstreamBaseUrl ?? ''}|${cfg?.cloud.envId ?? ''}|${cfg?.cloud.proxyUrl ?? ''}`
  if (key !== cachedTicketKey) {
    cachedTicketKey = key
    cachedTicketProvider = createTicketProvider(route, {
      providerName: cfg?.providerName ?? enrollment?.provider ?? 'byok',
      upstreamBaseUrl: cfg?.upstreamBaseUrl ?? enrollment?.upstreamBaseUrl ?? '',
      providerApiKey: cfg?.providerApiKey ?? '',
      model: enrollment?.model ?? 'unknown',
      allowedModels: cfg?.allowedModels,
      sim: cfg?.sim ?? { baseUrl: 'http://127.0.0.1:3426' },
      cloud: cfg?.cloud ?? { envId: route.cloudEnvId ?? '', proxyUrl: route.proxyBaseUrl ?? '', durableUrl: durableBase },
    })
  }
  return { base: durableBase, provider: cachedTicketProvider!, key }
}

export function ioStateFor(): IoState {
  const t = durableTicketProvider()
  if (t === null || !remoteDurableEnabled()) return localCas
  if (t.key !== cachedRemoteKey) {
    cachedRemoteKey = t.key
    cachedRemote = createRemoteCas({
      baseUrl: t.base,
      owner: 'self',
      headers: () => t.provider.authHeaders(t.base),
    })
  }
  return cachedRemote!
}

/** 前台铸票面：用户手势上下文（prompt/drive）调用——云 durable 车道无活票据时
 *  ready() 走 challenge→SOTER→unlock 铸票（enrollment 缺失→「未注入密钥」如实报错）。
 *  sharedTicket 模块级共享——此处铸成同时覆盖 remoteCas 与 io.llm 双车道（审查三轮 N1）。 */
export async function ensureDurableTicket(): Promise<void> {
  if (!remoteDurableEnabled() || hasFreshTicket()) return
  const t = durableTicketProvider()
  if (t === null) return
  await t.provider.ready()
}

/** 远端 vfs 客户端句柄：cloud 路由且开关开 → RemoteVfs；否则 null（诚实降级）。 */
export function vfsRemoteFor(): RemoteVfs | null {
  const t = durableTicketProvider()
  if (t === null || !remoteDurableEnabled()) return null
  return createRemoteVfs({ baseUrl: t.base, headers: () => t.provider.authHeaders(t.base) })
}

/** 远端镜像器：vfsRemoteFor 不可用 → null；调用方按 null 降级（本地行照常）。 */
export function vfsSyncFor(): VfsSync | null {
  const r = vfsRemoteFor()
  return r === null ? null : createVfsSync(r)
}
