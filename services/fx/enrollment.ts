/**
 * BYOK 注入与生物门禁（业主裁决：无 bio 时禁止 apikey 注入）。
 * - 注入记录（非密）存 wx.storage；api_key 只在 enroll 调用期间经过内存，不落盘。
 * - cloud 路由：能力检查=wx SOTER 两个 check；证明=wx.startSoterAuthentication。
 * - cloud-sim 路由：同构模拟 —— GET /sim/bio 查能力，POST /sim/bio 取签名证明。
 * - local 路由：无注入面（dev-config 直连）。
 */
import { storage } from '../storage'
import { DEFAULT_MODEL, MODELS } from '../config'
import type { RouteConfig } from './route'

export interface EnrollmentRecord {
  provider: string
  upstreamBaseUrl: string
  model: string
  enrolledAt: number
}

export interface BioStatus {
  ok: boolean
  supported: boolean
  enrolled: boolean
  reason?: string
}

interface BioProof {
  result_json: string
  result_signature: string
}

interface DevSource {
  providerName: string
  upstreamBaseUrl: string
  model: string
  providerApiKey: string
  allowedModels?: string[]
  sim: { baseUrl: string }
  cloud: { envId: string; proxyUrl: string }
}

export interface CredentialSource {
  provider: string
  upstreamBaseUrl: string
  model: string
  /** 'manual'=用户注入；'dev'=本地开发配置（仅 sim/local 允许）； */
  via: 'manual' | 'dev'
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

function getJSON(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      success: (r) => resolve(r.data as Record<string, unknown>),
      fail: (e) => reject(new Error(`${url} → ${JSON.stringify(e)}`)),
    })
  })
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

function wxCheckSoterSupport(): Promise<string[]> {
  return new Promise((resolve) => {
    wx.checkIsSupportSoterAuthentication({
      success: (r) => resolve((r.supportMode as string[] | undefined) ?? []),
      fail: () => resolve([]),
    })
  })
}

function wxCheckSoterEnrolled(modes: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (modes.length === 0) return resolve(false)
    wx.checkIsSoterEnrolledInDevice({
      checkAuthMode: modes[0] === 'facial' ? 'facial' : 'fingerPrint',
      success: (r) => resolve(r.isEnrolled === true),
      fail: () => resolve(false),
    })
  })
}

function wxStartSoter(challenge: string): Promise<BioProof> {
  return new Promise((resolve, reject) => {
    wx.startSoterAuthentication({
      requestAuthModes: ['fingerPrint', 'facial'],
      challenge,
      authContent: '确认本人操作以使用已托管的模型密钥',
      success: (r) => resolve({ result_json: r.resultJSON, result_signature: r.resultJSONSignature }),
      fail: (e) => reject(new Error(`生物识别未通过: ${e.errMsg ?? 'cancelled'}`)),
    })
  })
}

/** 生物门禁状态：注入与取票据的共同前置。 */
export async function bioStatus(route: RouteConfig): Promise<BioStatus> {
  if (route.mode === 'local') {
    return { ok: false, supported: false, enrolled: false, reason: '本地直连模式不经云端注入' }
  }
  if (route.mode === 'cloud-sim') {
    const base = route.simBaseUrl ?? 'http://127.0.0.1:3426'
    try {
      const s = (await getJSON(`${base}/sim/bio`)) as { supported?: boolean; enrolled?: boolean }
      const ok = s.supported === true && s.enrolled === true
      return { ok, supported: s.supported === true, enrolled: s.enrolled === true, reason: ok ? undefined : '模拟云端生物门禁已关闭（SIM_BIO）' }
    } catch (e) {
      return { ok: false, supported: false, enrolled: false, reason: `模拟云端不可达: ${e instanceof Error ? e.message : e}` }
    }
  }
  const modes = await wxCheckSoterSupport()
  if (modes.length === 0) return { ok: false, supported: false, enrolled: false, reason: '本设备不支持生物识别（指纹/面容）' }
  const enrolled = await wxCheckSoterEnrolled(modes)
  if (!enrolled) return { ok: false, supported: true, enrolled: false, reason: '设备未登记指纹/面容，无法注入密钥' }
  return { ok: true, supported: true, enrolled: true }
}

/** 取一次性 challenge（sim 走 HTTP 控制面；cloud 走 unlock 函数 action:'challenge'）。 */
export async function issueChallenge(route: RouteConfig, cfg: DevSource): Promise<string> {
  if (route.mode === 'cloud-sim') {
    const r = (await postJSON(`${route.simBaseUrl}/sim/challenge`, {})) as { challenge: string }
    return r.challenge
  }
  const r = await callCloud<{ challenge?: string; error?: string }>(cfg.cloud.envId, 'unlock', { action: 'challenge' })
  if (typeof r.challenge !== 'string') throw new Error(r.error ?? 'challenge 下发失败')
  return r.challenge
}

/** 用 challenge 换生物证明（sim 为同构签名证明；cloud 为真实 SOTER 签名）。 */
export async function collectBioProof(route: RouteConfig, challenge: string): Promise<BioProof> {
  if (route.mode === 'cloud-sim') {
    const r = (await postJSON(`${route.simBaseUrl}/sim/bio`, { challenge })) as { result_json?: string; result_signature?: string; error?: string }
    if (typeof r.result_json !== 'string' || typeof r.result_signature !== 'string') {
      throw new Error(r.error ?? '模拟生物门禁拒绝签发证明')
    }
    return { result_json: r.result_json, result_signature: r.result_signature }
  }
  const soter = await wxStartSoter(challenge)
  return { result_json: soter.result_json, result_signature: soter.result_signature }
}

export function readEnrollment(): EnrollmentRecord | undefined {
  return storage.getEnrollment<EnrollmentRecord>()
}

/** 原始 enroll 调用：challenge → bio 证明 → 服务端登记。不写本地记录。 */
async function enrollRaw(
  route: RouteConfig,
  cfg: DevSource,
  input: { apiKey: string; model: string; provider: string; upstreamBaseUrl: string },
): Promise<void> {
  const bio = await bioStatus(route)
  if (!bio.ok) throw new Error(`未通过生物门禁，禁止注入：${bio.reason ?? '生物识别不可用'}`)
  const challenge = await issueChallenge(route, cfg)
  const proof = await collectBioProof(route, challenge)
  const payload = {
    provider: input.provider,
    base_url: input.upstreamBaseUrl,
    api_key: input.apiKey,
    model: input.model,
    challenge,
    result_json: proof.result_json,
    result_signature: proof.result_signature,
  }
  if (route.mode === 'cloud-sim') {
    await postJSON(`${route.simBaseUrl}/sim/enroll`, payload)
    return
  }
  const r = await callCloud<{ ok?: boolean; error?: string }>(cfg.cloud.envId, 'enroll', payload)
  if (r.ok !== true) throw new Error(r.error ?? 'enroll 失败')
}

/** 用户在设置页注入 provider + api_key（bio 门禁强制；模型取当前已选）。 */
export async function enrollProvider(
  route: RouteConfig,
  cfg: DevSource,
  input: { apiKey: string; model?: string; provider?: string; upstreamBaseUrl?: string },
): Promise<EnrollmentRecord> {
  if (route.mode === 'local') throw new Error('本地直连模式不经云端注入')
  const provider = input.provider ?? cfg.providerName
  const upstreamBaseUrl = input.upstreamBaseUrl ?? cfg.upstreamBaseUrl
  const model = normalizeModel(input.model, cfg.allowedModels)
  if (typeof input.apiKey !== 'string') throw new Error('api_key 非法')
  await enrollRaw(route, cfg, { apiKey: input.apiKey, model, provider, upstreamBaseUrl })
  const record: EnrollmentRecord = { provider, upstreamBaseUrl, model, enrolledAt: Date.now() }
  storage.setEnrollment(record)
  return record
}

/** 撤回注入：删服务端记录 + 清本地非密记录。 */
export async function revokeEnrollment(route: RouteConfig, cfg: DevSource): Promise<void> {
  const rec = readEnrollment()
  storage.clearEnrollment()
  if (rec === undefined || route.mode === 'local') return
  if (route.mode === 'cloud-sim') {
    await postJSON(`${route.simBaseUrl}/sim/revoke`, { action: 'key', provider: rec.provider }).catch(() => {})
    return
  }
  await callCloud(cfg.cloud.envId, 'revoke', { action: 'key', provider: rec.provider }).catch(() => {})
}

function normalizeModel(model: string | undefined, allowed: string[] | undefined): string {
  const list = allowed !== undefined && allowed.length > 0 ? allowed : MODELS.map((m) => m.id)
  if (model !== undefined && list.includes(model)) return model
  return list.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : list[0] ?? DEFAULT_MODEL
}

/** 当前生效的模型：设置页选择（须在白名单内）→ dev-config 默认。 */
export function activeModel(cfg: DevSource): string {
  return normalizeModel(storage.getModel() ?? undefined, cfg.allowedModels ?? undefined)
}

/**
 * 解析本次 turn 的凭证来源。
 * - cloud：必须为用户注入记录，否则抛错引导去设置页。
 * - cloud-sim：注入记录优先；无则 dev-config 兜底（dev 面，服务端记录在 ensureServerEnrollment 内对齐）。
 * - local：dev-config 直连。
 */
export function resolveSource(route: RouteConfig, cfg: DevSource): CredentialSource {
  if (route.mode === 'local') {
    return { provider: cfg.providerName, upstreamBaseUrl: cfg.upstreamBaseUrl, model: activeModel(cfg), via: 'dev' }
  }
  const rec = readEnrollment()
  // 注入记录的 model 仅作登记信息；生效模型=当前设置选择（白名单内），切换模型无需重新注入。
  if (rec !== undefined) return { provider: rec.provider, upstreamBaseUrl: rec.upstreamBaseUrl, model: activeModel(cfg), via: 'manual' }
  if (route.mode === 'cloud') {
    throw new Error('尚未注入供应商密钥：请前往 设置 → 供应商 完成注入（需设备生物识别）')
  }
  return { provider: cfg.providerName, upstreamBaseUrl: cfg.upstreamBaseUrl, model: activeModel(cfg), via: 'dev' }
}

/**
 * 云端路由专用：确保服务端存在凭证记录（sim 下 dev 兜底自动注入；真云必须手动）。
 * enroll 调用自带 bio 门禁 —— sim 关 bio 时该路径同样被拒。
 */
export async function ensureServerEnrollment(route: RouteConfig, cfg: DevSource, source: CredentialSource): Promise<void> {
  if (route.mode !== 'cloud-sim' || source.via === 'manual') return
  const base = route.simBaseUrl ?? 'http://127.0.0.1:3426'
  const status = (await getJSON(`${base}/sim/status`)) as { records?: Array<{ provider?: string }> }
  const has = (status.records ?? []).some((r) => r.provider === source.provider)
  if (has) return
  // dev 自动注入：与手动同构（bio 门禁 + 服务端登记），但不写本地 manual 记录——下次仍以 dev 源解析。
  await enrollRaw(route, cfg, { apiKey: cfg.providerApiKey, model: source.model, provider: source.provider, upstreamBaseUrl: source.upstreamBaseUrl })
}
