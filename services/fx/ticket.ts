/**
 * 能力票据管理：local 直连无票据；cloud-sim 与 cloud 同构（challenge → bio 证明 → unlock 发票）。
 * 票据只证明「该 openid 已生物解锁」，不含 provider key 本身。
 * bio 门禁与注入面见 ./enrollment.ts（业主裁决：无 bio 禁止 apikey 注入）。
 */
import type { RouteConfig } from './route'
import { DSH_MINI_BASE_URL } from '../config'
import {
  collectBioProof,
  ensureServerEnrollment,
  issueChallenge,
  resolveSource,
  type CredentialSource,
} from './enrollment'

export interface TicketProvider {
  /** core 启动前调用：对齐凭证来源 +（云端路由）完成 enroll/unlock。返回生效的 provider 源。 */
  ready(): Promise<CredentialSource>
  /** 命中代理域时返回 Authorization 头；否则空对象。 */
  authHeaders(url: string): Promise<Record<string, string>>
}

interface TicketSource {
  providerName: string
  upstreamBaseUrl: string
  providerApiKey: string
  model: string
  allowedModels?: string[]
  sim: { baseUrl: string }
  cloud: { envId: string; proxyUrl: string; durableUrl?: string }
}

function postJSON(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data: body,
      success: (r) => {
        if (r.statusCode >= 400) reject(new Error(`${url} → ${r.statusCode} ${JSON.stringify(r.data).slice(0, 160)}`))
        else resolve(r.data as Record<string, unknown>)
      },
      fail: (e) => reject(new Error(`${url} → ${JSON.stringify(e)}`)),
    })
  })
}

const REFRESH_SKEW_MS = 60_000

/** 票据缓存为模块级共享：provider 每请求新建（io.llm/io.fx），实例缓存 = 每请求都重走 bio。
 *  票据 TTL 由 unlock 签发（当前 30min），窗口内复用、过期重验；并发 ensure 去重单飞。 */
let sharedTicket: { token: string; expMs: number } | undefined
let inflight: Promise<string> | undefined

function cachedTicket(): string | undefined {
  return sharedTicket !== undefined && sharedTicket.expMs - REFRESH_SKEW_MS > Date.now() ? sharedTicket.token : undefined
}

/** 有效票据已缓存（不触发 bio）：后台面（launch/tick）用它门控远端操作——
 *  无票据时不得静默发起 SOTER（生物识别须用户手势上下文，审查 B8）。 */
export function hasFreshTicket(): boolean {
  return cachedTicket() !== undefined
}

interface WxCloud {
  init(opts: { env?: string }): void
  callFunction(o: { name: string; data: Record<string, unknown> }): Promise<{ result: unknown }>
}

let cloudInited = false
function callCloud<T>(envId: string | undefined, name: string, data: Record<string, unknown>): Promise<T> {
  const cloudAny = wx.cloud as unknown as WxCloud | undefined
  if (cloudAny === undefined) return Promise.reject(new Error('wx.cloud 不可用（需云开发基础库）'))
  if (!cloudInited) {
    cloudInited = true
    if (envId !== undefined && envId.length > 0) cloudAny.init({ env: envId })
    else cloudAny.init({})
  }
  return cloudAny.callFunction({ name, data }).then((r) => r.result as T)
}

/** cloud-sim：HTTP 控制面（challenge → /sim/bio → /sim/unlock）。 */
class SimTicketProvider implements TicketProvider {
  constructor(
    private readonly simBase: string,
    private readonly proxyBase: string,
    private readonly route: RouteConfig,
    private readonly cfg: TicketSource,
  ) {}

  async ready(): Promise<CredentialSource> {
    const source = resolveSource(this.route, this.cfg)
    await ensureServerEnrollment(this.route, this.cfg, source)
    await this.ensure()
    return source
  }

  private async ensure(): Promise<string> {
    const hit = cachedTicket()
    if (hit !== undefined) return hit
    inflight ??= (async () => {
      const challenge = await issueChallenge(this.route, this.cfg)
      const proof = await collectBioProof(this.route, challenge)
      const u = (await postJSON(`${this.simBase}/sim/unlock`, {
        challenge,
        result_json: proof.result_json,
        result_signature: proof.result_signature,
      })) as { ticket: string; exp: number }
      sharedTicket = { token: u.ticket, expMs: u.exp * 1000 }
      return u.ticket
    })().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  async authHeaders(url: string): Promise<Record<string, string>> {
    if (!url.startsWith(this.proxyBase)) return {}
    return { Authorization: `Bearer ${await this.ensure()}` }
  }
}

/** 真云：wx.cloud.callFunction + SOTER（真机 R 车道面）。与 sim 同构，仅传输与证明实现不同。 */
class CloudTicketProvider implements TicketProvider {
  private readonly durableBase: string | undefined

  constructor(
    private readonly proxyBase: string,
    private readonly envId: string | undefined,
    private readonly route: RouteConfig,
    private readonly cfg: TicketSource,
  ) {
    // durable 收窄面（POD1 fss3）：同 unlock 票据、同 scope——命中 durableBase 亦注入。
    // durableUrl 缺省时与 provider.ts 同回落 DSH_MINI_BASE_URL——否则请求发默认域却不带票据静默 401。
    const d = cfg.cloud.durableUrl
    this.durableBase = (d !== undefined && d.length > 0 ? d : DSH_MINI_BASE_URL).replace(/\/$/, '')
  }

  async ready(): Promise<CredentialSource> {
    const source = resolveSource(this.route, this.cfg)
    await this.ensure()
    return source
  }

  private async ensure(): Promise<string> {
    const hit = cachedTicket()
    if (hit !== undefined) return hit
    inflight ??= (async () => {
      const challenge = await issueChallenge(this.route, this.cfg)
      const proof = await collectBioProof(this.route, challenge)
      const u = await callCloud<{ ticket: string; exp: number; error?: string }>(this.envId, 'unlock', {
        action: 'unlock',
        challenge,
        result_json: proof.result_json,
        result_signature: proof.result_signature,
      })
      if (typeof u.ticket !== 'string') throw new Error(u.error ?? 'unlock 失败')
      sharedTicket = { token: u.ticket, expMs: u.exp * 1000 }
      return u.ticket
    })().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  async authHeaders(url: string): Promise<Record<string, string>> {
    const hit = url.startsWith(this.proxyBase)
      || (this.durableBase !== undefined && url.startsWith(this.durableBase))
    if (!hit) return {}
    return { Authorization: `Bearer ${await this.ensure()}` }
  }
}

class LocalTicketProvider implements TicketProvider {
  constructor(
    private readonly route: RouteConfig,
    private readonly cfg: TicketSource,
  ) {}

  async ready(): Promise<CredentialSource> {
    return resolveSource(this.route, this.cfg)
  }

  async authHeaders(_url: string): Promise<Record<string, string>> {
    return {}
  }
}

export function createTicketProvider(route: RouteConfig, cfg: TicketSource): TicketProvider {
  if (route.mode === 'cloud-sim' && route.proxyBaseUrl !== undefined && route.simBaseUrl !== undefined) {
    return new SimTicketProvider(route.simBaseUrl, route.proxyBaseUrl, route, cfg)
  }
  if (route.mode === 'cloud' && route.proxyBaseUrl !== undefined) {
    return new CloudTicketProvider(route.proxyBaseUrl, route.cloudEnvId, route, cfg)
  }
  return new LocalTicketProvider(route, cfg)
}
