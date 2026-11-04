import { APP_ID, APP_VERSION, DEFAULT_MODEL, MODELS, type ModelOption } from '../../services/config'
import { sessionStore } from '../../services/session-store'
import { storage } from '../../services/storage'
import { DEFAULT_PERMISSION, PERMISSIONS, permissionOf, type PermissionOption } from '../../services/permissions'
import { applyNavigationBar, getTheme, setTheme, useSystemTheme, type Theme } from '../../services/theme'
import {
  getStoredUser,
  loginWithEmail,
  loginWithWechatCode,
  registerWithEmail,
  wxLogin,
} from '../../services/nano/http'
import { nanoRuntime } from '../../services/nano/runtime'
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
import { getWindowMetrics } from '../../utils/window'

type ThemeMode = 'system' | 'light' | 'dark'
type DialogAction = 'clear' | 'reset'

const FX_LICENSE_URL = 'https://github.com/vercel-labs/fx/blob/main/LICENSE'

interface Section {
  id: 'general' | 'account' | 'models' | 'providers' | 'storage' | 'plugins' | 'archived' | 'conversations' | 'about'
  label: string
  icon: string
}

const SECTIONS: Section[] = [
  { id: 'general', label: '通用', icon: 'settings-outline' },
  { id: 'account', label: '账户', icon: 'user-outline' },
  { id: 'models', label: '模型', icon: 'layers-outline' },
  { id: 'providers', label: '供应商', icon: 'globe-outline' },
  { id: 'storage', label: '存储', icon: 'folder-open-outline' },
  { id: 'plugins', label: '插件', icon: 'plugin-pinwheel-outline' },
  { id: 'archived', label: '归档', icon: 'archive-outline' },
  { id: 'conversations', label: '会话', icon: 'list-pen-outline' },
  { id: 'about', label: '关于', icon: 'info-outline' },
]

Page({
  data: {
    statusBarHeight: 0,
    navBarContentHeight: 44,
    capsuleInsetRight: 96,
    appStyle: '',
    theme: 'light' as Theme,
    themeMode: 'system' as ThemeMode,
    permissions: PERMISSIONS,
    permission: DEFAULT_PERMISSION.id,
    permissionLabel: DEFAULT_PERMISSION.label,
    activeId: 'general' as Section['id'],
    sections: SECTIONS,
    version: APP_VERSION,
    appId: APP_ID,
    sessionCount: 0,
    model: DEFAULT_MODEL,
    modelLabel: MODELS[0]?.label ?? DEFAULT_MODEL,
    models: MODELS as ModelOption[],
    providers: [{ id: 'magpie', name: 'magpie', description: 'OpenAI 兼容端点 · 信封加密托管' }],
    plugins: [
      { name: 'dsh-client-ui-chat', description: 'Chat / Markdown / Tool cards' },
      { name: 'dsh-client-ui-conversation', description: 'Hero / Composer / Settings shell' },
      { name: 'dsh-client-ui-sidebar', description: 'Sidebar / Workspace browser' },
    ],
    dialogVisible: false,
    dialogAction: 'clear' as DialogAction,
    dialogTitle: '',
    dialogDescription: '',
    dialogConfirmText: '清空',
    toastVisible: false,
    toastMessage: '',
    toastTone: 'info',
    nanoConnected: nanoRuntime.isAvailable(),
    nanoUser: getStoredUser()?.display_name ?? '',
    nanoInitial: initialOf(getStoredUser()?.display_name),
    email: '',
    password: '',
    displayName: '',
    authMode: 'login' as 'login' | 'register',
    authBusy: false,
    authError: '',
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
  },

  onLoad(options: Record<string, string | undefined>) {
    const section = options.section
    const theme = getTheme()
    applyNavigationBar(theme, 'layer-2')
    const storedTheme = storage.getTheme()
    const permission = permissionOf(storage.getPermission())
    const model = storage.getModel() ?? DEFAULT_MODEL
    const metrics = getWindowMetrics()
    this.setData({
      activeId: isSection(section) ? section : 'general',
      permission: permission.id,
      permissionLabel: permission.label,
      statusBarHeight: metrics.statusBarHeight,
      navBarContentHeight: metrics.navBarContentHeight,
      capsuleInsetRight: metrics.capsuleInsetRight,
      appStyle: layoutStyle(metrics),
      theme,
      themeMode: storedTheme ?? 'system',
      sessionCount: sessionStore.getState().sessions.length,
      model,
      modelLabel: MODELS.find((item) => item.id === model)?.label ?? model,
      nanoConnected: nanoRuntime.isAvailable(),
      nanoUser: getStoredUser()?.display_name ?? '',
      nanoInitial: initialOf(getStoredUser()?.display_name),
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
    const storedTheme = storage.getTheme()
    this.setData({
      theme,
      themeMode: storedTheme ?? 'system',
      sessionCount: sessionStore.getState().sessions.length,
      nanoConnected: nanoRuntime.isAvailable(),
      nanoUser: getStoredUser()?.display_name ?? '',
      nanoInitial: initialOf(getStoredUser()?.display_name),
    })
    applyNavigationBar(theme, 'layer-2')
    void this.refreshByok()
  },

  onUnload() {
    applyNavigationBar(getTheme())
  },

  onPermission(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '')
    const permission: PermissionOption | undefined = PERMISSIONS.find((item) => item.id === id)
    if (permission === undefined) return
    storage.setPermission(permission.id)
    this.setData({ permission: permission.id, permissionLabel: permission.label })
    this.showToast(`默认权限：${permission.label}`, 'success')
  },

  selectSection(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? 'general') as Section['id']
    this.setData({ activeId: id })
  },

  onThemeMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode ?? 'system') as ThemeMode
    let theme: Theme
    if (mode === 'system') theme = useSystemTheme()
    else {
      theme = mode
      setTheme(mode)
    }
    applyNavigationBar(theme, 'layer-2')
    this.setData({ theme, themeMode: mode })
  },

  selectModel(event: WechatMiniprogram.TouchEvent) {
    const model = String(event.currentTarget.dataset.id ?? '')
    const option = MODELS.find((item) => item.id === model)
    if (option === undefined) return
    storage.setModel(option.id)
    this.setData({ model: option.id, modelLabel: option.label, injectModelLabel: option.label })
    // 本地 fx 运行时的生效模型在 core 启动时注入 env，切换后需重启生效（未启动时为空操作）
    fxRuntime.restartCore()
  },

  async refreshByok() {
    const cfg = loadDevConfig()
    const route = cfg !== undefined ? safeRoute(cfg) : { mode: 'local' as RouteMode }
    const injectable = route.mode !== 'local'
    const rec = readEnrollment()
    const bio = injectable
      ? await bioStatus(route)
      : { ok: false, supported: false, enrolled: false, reason: '本地直连模式不经云端注入' }
    const activeModel = storage.getModel() ?? DEFAULT_MODEL
    this.setData({
      fxRoute: route.mode,
      routeLabel: route.mode === 'cloud' ? '微信云端' : route.mode === 'cloud-sim' ? '模拟云端' : '本地直连',
      bioOk: bio.ok,
      bioText: bio.ok ? '生物识别可用 · 注入与解锁需本人验证' : (bio.reason ?? '生物识别不可用'),
      enrolled: rec !== undefined,
      enrolledProvider: rec?.provider ?? '',
      enrolledBaseUrl: rec?.upstreamBaseUrl ?? '',
      enrolledAt: rec !== undefined ? new Date(rec.enrolledAt).toLocaleString() : '',
      enrollModel: rec?.model ?? activeModel,
      injectModelLabel: MODELS.find((m) => m.id === activeModel)?.label ?? activeModel,
      baseUrl: this.data.baseUrl !== '' ? this.data.baseUrl : cfg?.upstreamBaseUrl ?? '',
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
      fxRuntime.restartCore()
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
    } finally {
      this.setData({ enrollBusy: false })
    }
  },

  async revokeProvider() {
    const cfg = loadDevConfig()
    if (cfg === undefined) return
    try {
      await revokeEnrollment(resolveRoute(cfg), cfg)
      fxRuntime.restartCore()
      this.setData({ enrolled: false, enrolledProvider: '', enrolledBaseUrl: '', enrolledAt: '' })
      this.showToast('已撤回云端密钥记录', 'info')
    } catch (error) {
      this.showToast(messageOf(error), 'error')
    }
  },

  copyFxLicense() {
    wx.setClipboardData({ data: FX_LICENSE_URL })
    this.showToast('fx 许可地址已复制（Apache-2.0 · vercel-labs/fx）', 'info')
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
    vfsStore.setS3Config({ endpoint, bucket, region, path_style: true, configured_ms: Date.now() })
    this.setData({ s3Configured: true, s3ConfiguredAt: new Date().toLocaleString(), s3Error: '' })
    this.showToast('S3 配置已登记（占位 · 后端未启用）', 'info')
  },

  clearS3Config() {
    vfsStore.clearS3Config()
    this.setData({ s3Endpoint: '', s3Bucket: '', s3Region: '', s3Configured: false, s3ConfiguredAt: '', s3Error: '' })
    this.showToast('已清除 S3 配置', 'info')
  },

  clearConversations() {
    this.setData({
      dialogVisible: true,
      dialogAction: 'clear',
      dialogTitle: '清空所有会话',
      dialogDescription: '所有本地会话和消息都会被删除，无法恢复。',
      dialogConfirmText: '清空',
    })
  },

  resetAll() {
    this.setData({
      dialogVisible: true,
      dialogAction: 'reset',
      dialogTitle: '恢复初始状态',
      dialogDescription: '将清除主题、模型和所有本地会话。',
      dialogConfirmText: '恢复',
    })
  },

  closeDialog() {
    this.setData({ dialogVisible: false })
  },

  async onDialogConfirm() {
    if (this.data.dialogAction === 'clear') {
      await sessionStore.clearAll()
    } else {
      await sessionStore.clearAll()
      storage.clearAll()
    }
    this.setData({ dialogVisible: false })
    wx.reLaunch({ url: '/pages/workspace/workspace' })
  },

  closeToast() {
    this.setData({ toastVisible: false })
  },

  onEmailInput(event: WechatMiniprogram.Input) {
    this.setData({ email: event.detail.value, authError: '' })
  },

  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: event.detail.value, authError: '' })
  },

  onDisplayNameInput(event: WechatMiniprogram.Input) {
    this.setData({ displayName: event.detail.value, authError: '' })
  },

  toggleAuthMode() {
    this.setData({ authMode: this.data.authMode === 'login' ? 'register' : 'login', authError: '' })
  },

  async submitEmailAuth() {
    if (this.data.authBusy) return
    const email = this.data.email.trim()
    const password = this.data.password
    if (email.length === 0 || password.length === 0) {
      this.setData({ authError: '请输入邮箱和密码' })
      return
    }
    this.setData({ authBusy: true, authError: '' })
    try {
      if (this.data.authMode === 'register') {
        await registerWithEmail(email, password, this.data.displayName.trim() || email.split('@')[0] || email)
      } else {
        await loginWithEmail(email, password)
      }
      await this.afterSignIn()
      this.showToast(this.data.authMode === 'register' ? '账户已创建并连接' : '已连接 nano-agent', 'success')
    } catch (error) {
      this.setData({ authError: messageOf(error) })
    } finally {
      this.setData({ authBusy: false })
    }
  },

  async wechatLogin() {
    if (this.data.authBusy) return
    this.setData({ authBusy: true, authError: '' })
    try {
      const code = await wxLogin()
      await loginWithWechatCode(code)
      await this.afterSignIn()
      this.showToast('已通过微信登录', 'success')
    } catch (error) {
      this.setData({ authError: messageOf(error) })
    } finally {
      this.setData({ authBusy: false })
    }
  },

  async signOut() {
    nanoRuntime.signOut()
    await sessionStore.reinitialize()
    this.setData({
      nanoConnected: false,
      nanoUser: '',
      nanoInitial: 'n',
      sessionCount: 0,
    })
    this.showToast('已退出 nano-agent', 'info')
  },

  async afterSignIn() {
    await sessionStore.reinitialize()
    this.setData({
      nanoConnected: true,
      nanoUser: getStoredUser()?.display_name ?? '',
      nanoInitial: initialOf(getStoredUser()?.display_name),
      sessionCount: sessionStore.getState().sessions.length,
      email: '',
      password: '',
      displayName: '',
      authError: '',
    })
  },

  showToast(message: string, tone = 'info') {
    this.setData({ toastVisible: true, toastMessage: message, toastTone: tone })
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}

function safeRoute(cfg: Parameters<typeof resolveRoute>[0]): { mode: RouteMode } {
  try {
    return resolveRoute(cfg)
  } catch {
    return { mode: 'local' }
  }
}

function isSection(value: string | undefined): value is Section['id'] {
  return value !== undefined && SECTIONS.some((section) => section.id === value)
}

function initialOf(name: string | undefined): string {
  const value = name?.trim() ?? ''
  return value.length > 0 ? value.slice(0, 1).toUpperCase() : 'n'
}
