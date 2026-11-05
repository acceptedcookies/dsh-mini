import { DEFAULT_MODEL, MODELS, modelsForEngine } from '../../services/config'
import { pendingEngine } from '../../services/session-engine'
import { storage } from '../../services/storage'
import { applyNavigationBar, getTheme, type Theme } from '../../services/theme'
import { loadDevConfig } from '../../services/fx/dev'
import { resolveRoute, type RouteMode } from '../../services/fx/route'
import {
  bioStatus,
  enrollProvider,
  readEnrollment,
  revokeEnrollment,
} from '../../services/fx/enrollment'
import { fxRuntime } from '../../services/fx/runtime'
import { vfsStore } from '../../services/vfs/api'
import { errorBus, reportSilent, type ErrorReport } from '../../services/error-report'
import { getWindowMetrics } from '../../utils/window'

/* 模型配置页（业主 MN05-W4）：自 settings 拆出——模型选择 + 供应商密钥托管。 */
interface Section {
  id: 'models' | 'providers' | 'storage'
  label: string
  icon: string
}

const SECTIONS: Section[] = [
  { id: 'models', label: '模型', icon: 'layers-outline' },
  { id: 'providers', label: '供应商', icon: 'globe-outline' },
  { id: 'storage', label: '存储', icon: 'folder-open-outline' },
]

let unsubscribeErr: (() => void) | undefined

Page({
  data: {
    statusBarHeight: 0,
    navBarContentHeight: 44,
    capsuleInsetRight: 96,
    appStyle: '',
    theme: 'light' as Theme,
    activeId: 'models' as Section['id'],
    sections: SECTIONS,
    model: DEFAULT_MODEL,
    modelLabel: MODELS[0]?.label ?? DEFAULT_MODEL,
    models: modelsForEngine(pendingEngine()),
    toastVisible: false,
    toastMessage: '',
    toastTone: 'info',
    fxRoute: 'local' as RouteMode,
    routeLabel: '本地直连',
    injectModelLabel: '',
    bioOk: false,
    bioText: '',
    enrolled: false,
    enrolledProvider: '',
    enrolledBaseUrl: '',
    enrolledAt: '',
    enrollModel: '',
    baseUrl: '',
    apiKey: '',
    enrollBusy: false,
    enrollError: '',
    s3Endpoint: '',
    s3Bucket: '',
    s3Region: '',
    s3Configured: false,
    s3ConfiguredAt: '',
    s3Error: '',
    errToasts: [] as ErrorReport[],
    errModal: null as ErrorReport | null,
    errPending: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (unsubscribeErr !== undefined) unsubscribeErr()
    unsubscribeErr = errorBus.subscribe((bus) => this.setData({ errToasts: bus.toasts, errModal: bus.modal ?? null, errPending: bus.pendingCount }))
    const section = options.section
    const theme = getTheme()
    applyNavigationBar(theme, 'layer-2')
    const lane = modelsForEngine(pendingEngine())
    const picked = storage.getModel()
    const model = picked !== undefined && lane.some((m) => m.id === picked) ? picked : (lane[0]?.id ?? DEFAULT_MODEL)
    const metrics = getWindowMetrics()
    this.setData({
      activeId: isSection(section) ? section : 'models',
      statusBarHeight: metrics.statusBarHeight,
      navBarContentHeight: metrics.navBarContentHeight,
      capsuleInsetRight: metrics.capsuleInsetRight,
      appStyle: layoutStyle(metrics),
      theme,
      model,
      modelLabel: lane.find((item) => item.id === model)?.label ?? model,
      models: lane,
    })
    const s3 = vfsStore.getS3Config()
    if (s3 !== undefined) {
      this.setData({
        s3Endpoint: s3.endpoint,
        s3Bucket: s3.bucket,
        s3Region: s3.region,
        s3Configured: true,
        s3ConfiguredAt: new Date(s3.configured_ms).toLocaleString(),
      })
    }
  },

  onShow() {
    const theme = getTheme()
    this.setData({ theme })
    applyNavigationBar(theme, 'layer-2')
    void this.refreshByok()
  },

  onUnload() {
    if (unsubscribeErr !== undefined) {
      unsubscribeErr()
      unsubscribeErr = undefined
    }
  },

  // ── error-center 事件面（与 settings/workspace 同构）────────────

  onErrToastClose(event: WechatMiniprogram.CustomEvent<{ id: string; surface?: string }>) {
    errorBus.dismiss(event.detail.id, event.detail.surface === 'toast' ? 'toast' : undefined)
  },

  onErrDetail(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    errorBus.openDetail(event.detail.id)
  },

  onErrModalClose() {
    const modal = this.data.errModal
    if (modal !== null) errorBus.dismiss(modal.id, 'modal')
  },

  onErrCopied() {
    this.showToast('错误全文已复制', 'success')
  },

  onErrCopyFailed() {
    this.showToast('复制失败', 'error')
  },

  selectSection(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? 'models') as Section['id']
    this.setData({ activeId: id })
  },

  selectModel(event: WechatMiniprogram.TouchEvent) {
    const model = String(event.currentTarget.dataset.id ?? '')
    // 新会话引擎面白名单：BYOK 车道不显示/不接受 magpie 模型 id（业主 MN04）。
    const option = modelsForEngine(pendingEngine()).find((item) => item.id === model)
    if (option === undefined) return
    storage.setModel(option.id)
    this.setData({ model: option.id, modelLabel: option.label, injectModelLabel: option.label })
    // 本地 fx 运行时的生效模型在 core 启动时注入 env，切换后需重启生效（未启动时为空操作）
    try {
      fxRuntime.restartCore()
    } catch (error) {
      errorBus.report(error, { op: 'model-switch', lane: 'ui' })
    }
  },

  async refreshByok() {
    const cfg = loadDevConfig()
    // 缺席也过 resolveRoute（app.json 旋钮真源在其内），解析错误经 err 如实显示（UI 审查 F10）
    const route = safeRoute(cfg)
    const routeErr = route.err
    const injectable = route.mode !== 'local'
    const rec = readEnrollment()
    const bio = injectable
      ? await bioStatus(route)
      : { ok: false, supported: false, enrolled: false, reason: '本地直连模式不经云端注入' }
    const byokLane = modelsForEngine(pendingEngine())
    const stored = storage.getModel()
    const activeModel = stored !== undefined && byokLane.some((m) => m.id === stored) ? stored : (byokLane[0]?.id ?? DEFAULT_MODEL)
    this.setData({
      fxRoute: route.mode,
      routeLabel: routeErr !== undefined
        ? `本地直连 · 路由解析失败：${routeErr.slice(0, 60)}`
        : route.mode === 'cloud' ? '微信云端' : route.mode === 'cloud-sim' ? '模拟云端' : '本地直连',
      bioOk: bio.ok,
      bioText: bio.ok ? '生物识别可用 · 注入与解锁需本人验证' : (bio.reason ?? '生物识别不可用'),
      enrolled: rec !== undefined,
      enrolledProvider: rec?.provider ?? '',
      enrolledBaseUrl: rec?.upstreamBaseUrl ?? '',
      enrolledAt: rec !== undefined ? new Date(rec.enrolledAt).toLocaleString() : '',
      enrollModel: rec?.model ?? activeModel,
      injectModelLabel: byokLane.find((m) => m.id === activeModel)?.label ?? activeModel,
      // 云端车道不预填 loopback 上游（真机上 127.0.0.1 无意义）——留空强制手填真实供应商地址
      baseUrl:
        this.data.baseUrl !== ''
          ? this.data.baseUrl
          : route.mode !== 'local' && (cfg?.upstreamBaseUrl ?? '').includes('127.0.0.1')
            ? ''
            : (cfg?.upstreamBaseUrl ?? ''),
    })
  },

  onBaseUrlInput(event: WechatMiniprogram.Input) {
    this.setData({ baseUrl: event.detail.value, enrollError: '' })
  },

  onApiKeyInput(event: WechatMiniprogram.Input) {
    this.setData({ apiKey: event.detail.value, enrollError: '' })
  },

  async submitEnroll() {
    if (this.data.enrollBusy || !this.data.bioOk) return
    const cfg = loadDevConfig()
    if (cfg === undefined) {
      this.setData({ enrollError: 'dev-config 缺失：先运行 node scripts/fx-dev-config.mjs' })
      return
    }
    const baseUrl = this.data.baseUrl.trim()
    if (baseUrl.length === 0) {
      this.setData({ enrollError: '请填写供应商地址' })
      return
    }
    this.setData({ enrollBusy: true, enrollError: '' })
    try {
      const rec = await enrollProvider(resolveRoute(cfg), cfg, {
        apiKey: this.data.apiKey.trim(),
        upstreamBaseUrl: baseUrl,
        model: this.data.enrollModel,
      })
      try {
        fxRuntime.restartCore()
      } catch (error) {
        errorBus.report(error, { op: 'core-restart', lane: 'ui' })
      }
      this.setData({
        apiKey: '',
        enrolled: true,
        enrolledProvider: rec.provider,
        enrolledBaseUrl: rec.upstreamBaseUrl,
        enrolledAt: new Date(rec.enrolledAt).toLocaleString(),
        enrollModel: rec.model,
      })
      this.showToast('密钥已注入云端托管', 'success')
    } catch (error) {
      this.setData({ enrollError: messageOf(error) })
      // enrollError 是专属内联面——进 silent 台账供诊断聚合不双弹（MN03-R1）。
      reportSilent(error, { op: 'enroll-provider', lane: 'ui' })
    } finally {
      this.setData({ enrollBusy: false })
    }
  },

  async revokeProvider() {
    const cfg = loadDevConfig()
    if (cfg === undefined) return
    try {
      await revokeEnrollment(resolveRoute(cfg), cfg)
      try {
        fxRuntime.restartCore()
      } catch (error) {
        errorBus.report(error, { op: 'core-restart', lane: 'ui' })
      }
      this.setData({ enrolled: false, enrolledProvider: '', enrolledBaseUrl: '', enrolledAt: '' })
      this.showToast('已撤回云端密钥记录', 'info')
    } catch (error) {
      errorBus.report(error, { op: 'revoke-provider', lane: 'ui' })
    }
  },

  onS3EndpointInput(event: WechatMiniprogram.Input) {
    this.setData({ s3Endpoint: event.detail.value, s3Error: '' })
  },

  onS3BucketInput(event: WechatMiniprogram.Input) {
    this.setData({ s3Bucket: event.detail.value, s3Error: '' })
  },

  onS3RegionInput(event: WechatMiniprogram.Input) {
    this.setData({ s3Region: event.detail.value, s3Error: '' })
  },

  /** S3 后端占位：仅存非密配置（endpoint/bucket/region），access_key 引用名不落盘，后端未启用。 */
  saveS3Config() {
    const endpoint = this.data.s3Endpoint.trim()
    const bucket = this.data.s3Bucket.trim()
    const region = this.data.s3Region.trim() || 'auto'
    if (endpoint.length === 0 || bucket.length === 0) {
      this.setData({ s3Error: 'endpoint 与 bucket 必填' })
      return
    }
    try {
      vfsStore.setS3Config({ endpoint, bucket, region, path_style: true, configured_ms: Date.now() })
    } catch (error) {
      this.setData({ s3Error: messageOf(error) })
      reportSilent(error, { op: 's3-config', lane: 'ui' })
      return
    }
    this.setData({ s3Configured: true, s3ConfiguredAt: new Date().toLocaleString(), s3Error: '' })
    this.showToast('S3 配置已登记（占位 · 后端未启用）', 'info')
  },

  clearS3Config() {
    try {
      vfsStore.clearS3Config()
    } catch (error) {
      this.setData({ s3Error: messageOf(error) })
      reportSilent(error, { op: 's3-config-clear', lane: 'ui' })
      return
    }
    this.setData({ s3Endpoint: '', s3Bucket: '', s3Region: '', s3Configured: false, s3ConfiguredAt: '', s3Error: '' })
    this.showToast('已清除 S3 配置', 'info')
  },

  showToast(message: string, tone = 'info') {
    this.setData({ toastVisible: true, toastMessage: message, toastTone: tone })
  },

  closeToast() {
    this.setData({ toastVisible: false })
  },

  back() {
    wx.navigateBack()
  },
})

function layoutStyle(metrics: ReturnType<typeof getWindowMetrics>): string {
  return [
    `--app-status-bar: ${metrics.statusBarHeight}px`,
    `--app-nav-height: ${metrics.statusBarHeight + metrics.navBarContentHeight}px`,
    `--app-capsule-right: ${metrics.capsuleInsetRight}px`,
    `--app-safe-bottom: ${metrics.safeAreaBottom}px`,
  ].join('; ')
}

function safeRoute(cfg: Parameters<typeof resolveRoute>[0] | undefined): { mode: RouteMode; err?: string } {
  try {
    return { mode: resolveRoute(cfg ?? {}).mode }
  } catch (e) {
    return { mode: 'local', err: e instanceof Error ? e.message : String(e) }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}

function isSection(value: string | undefined): value is Section['id'] {
  return value !== undefined && SECTIONS.some((section) => section.id === value)
}
