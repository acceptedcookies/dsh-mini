import { sessionStore } from '../../services/session-store'
import { nanoRuntime } from '../../services/nano/runtime'
import { fetchTodos, fetchWorkspaceFiles } from '../../services/nano/http'
import { pickImage } from '../../services/upload'
import { APP_VERSION, DEFAULT_MODEL, MODELS, type ModelOption } from '../../services/config'
import { applyNavigationBar, getTheme, type Theme } from '../../services/theme'
import { storage } from '../../services/storage'
import { DEFAULT_PERMISSION, PERMISSIONS, permissionOf, type PermissionOption } from '../../services/permissions'
import { firstCommand } from '../../services/commands'
import { formatRelative } from '../../utils/time'
import { toolView, type ToolView } from '../../utils/tool-view'
import { getWindowMetrics, isWideLayout, type WindowMetrics } from '../../utils/window'
import type {
  ApprovalOutcome,
  ApprovalRequest,
  ChatItem,
  ImageRef,
  QuestionAnswer,
  QuestionRequest,
  SessionSummary,
  UiState,
} from '../../types/protocol'

interface SessionRow extends SessionSummary {
  timeLabel: string
}

/* Tool rows carry their dsh presentation projection (utils/tool-view). */
type DisplayItem = ChatItem & {
  turn?: number
  turnLabel?: string
  turnCollapsible?: boolean
  process?: boolean
  processHidden?: boolean
  toolView?: ToolView
}

interface TurnMark {
  turn: number
  target: string
  label: string
  active: boolean
}

interface MenuItem {
  id: string
  label: string
  icon?: string
  tone?: string
  danger?: boolean
  shortcut?: string
}

type MenuContext = 'session' | 'workspace' | 'header-session' | 'permission'
type DialogAction = 'rename' | 'delete' | 'goal' | 'feedback' | 'permission-auto'


const WORKSPACE_NAME = 'dsh-mini'

/* dsh InputBar placeholder copy; narrow frames drop the / and @ hint so the
   line does not wrap inside the 16px touch composer. */
const HERO_PLACEHOLDER = '描述你想要构建的内容, / 调用指令, @ 文件或对话'
const HERO_PLACEHOLDER_NARROW = '描述你想要构建的内容'
const DOCKED_PLACEHOLDER = '发消息或创建任务, / 调用指令, @ 文件或对话'
const DOCKED_PLACEHOLDER_NARROW = '发消息或创建任务'
const PLAN_PLACEHOLDER = '描述你的任务以生成计划'

function placeholderData(wide: boolean, planMode = false): { heroPlaceholder: string; dockedPlaceholder: string } {
  if (planMode) return { heroPlaceholder: PLAN_PLACEHOLDER, dockedPlaceholder: PLAN_PLACEHOLDER }
  return {
    heroPlaceholder: wide ? HERO_PLACEHOLDER : HERO_PLACEHOLDER_NARROW,
    dockedPlaceholder: wide ? DOCKED_PLACEHOLDER : DOCKED_PLACEHOLDER_NARROW,
  }
}

const SLASH_ALIASES: Record<string, string> = {
  '目标': 'goal',
  '计划': 'plan',
  '反馈': 'feedback',
  '压缩': 'compact',
  '权限': 'permission',
  '模型': 'model',
  '导出': 'export',
  '文件': 'file',
  goal: 'goal',
  plan: 'plan',
  feedback: 'feedback',
  compact: 'compact',
  permission: 'permission',
  model: 'model',
  export: 'export',
  file: 'file',
}

const SESSION_MENU: MenuItem[] = [
  { id: 'rename', label: '重命名', icon: 'edit-outline' },
  { id: 'delete', label: '删除会话', icon: 'trash-outline', danger: true },
]

const WORKSPACE_MENU: MenuItem[] = [
  { id: 'new-session', label: '新会话', icon: 'new-chat-outline' },
  { id: 'settings', label: '设置', icon: 'settings-outline' },
]

let unsubscribe: (() => void) | undefined
let resizeHandler: ((result: WechatMiniprogram.OnWindowResizeListenerResult) => void) | undefined
let runClock: ReturnType<typeof setInterval> | undefined

Page({
  data: {
    theme: 'light' as Theme,
    state: sessionStore.getState() as UiState,
    statusBarHeight: 0,
    navBarContentHeight: 44,
    capsuleInsetRight: 96,
    appStyle: '',
    windowWidth: 375,
    isWide: false,
    sidebarOpen: false,
    currentId: '',
    title: '新会话',
    workspaceName: WORKSPACE_NAME,
    input: '',
    pendingImages: [] as ImageRef[],
    heroPlaceholder: HERO_PLACEHOLDER,
    dockedPlaceholder: DOCKED_PLACEHOLDER,
    scrollTarget: '',
    model: DEFAULT_MODEL,
    modelLabel: MODELS[0]?.label ?? DEFAULT_MODEL,
    models: MODELS as ModelOption[],
    modelPickerVisible: false,
    modelPickerStyle: '',
    approval: null as ApprovalRequest | null,
    question: null as QuestionRequest | null,
    rows: [] as SessionRow[],
    query: '',
    version: APP_VERSION,
    runtimeLabel: sessionStore.runtimeLabel(),
    showHero: true,
    view: 'chat' as 'chat' | 'trajectory',
    collapsedTurns: {} as Record<number, boolean>,
    atTail: true,
    chatViewportHeight: 0,
    displayItems: [] as DisplayItem[],
    turnMarks: [] as TurnMark[],
    rightOpen: false,
    rightLoading: false,
    rightError: '',
    rightFiles: [] as Array<{ path: string; size: string; mime: string }>,
    rightTodos: [] as Array<{ id: string; content: string; status: string }>,
    nanoConnected: nanoRuntime.isAvailable(),
    rightTab: 'files',
    rightTabs: [
      { id: 'files', label: '文件', icon: 'folder-open-outline' },
      { id: 'terminal', label: '终端', icon: 'code-outline' },
      { id: 'browser', label: '浏览器', icon: 'globe-outline' },
      { id: 'jobs', label: '任务', icon: 'clock-outline' },
      { id: 'plan', label: '计划', icon: 'plan-outline' },
      { id: 'team', label: '团队', icon: 'users-outline' },
    ],
    menuVisible: false,
    menuItems: [] as MenuItem[],
    menuTitle: '',
    menuStyle: '',
    menuContext: 'session' as MenuContext,
    menuTargetId: '',
    dialogVisible: false,
    dialogAction: 'rename' as DialogAction,
    dialogTargetId: '',
    dialogTitle: '',
    dialogDescription: '',
    dialogValue: '',
    dialogEditable: false,
    dialogTone: 'default',
    dialogDanger: false,
    dialogConfirmText: '确定',
    toastVisible: false,
    toastMessage: '',
    toastTone: 'info',
    runStartedAt: 0,
    runLabel: '深度求索中',
    commandMenuVisible: false,
    commandMenuQuery: '',
    commandMenuStyle: '',
    commandMenuMaxHeight: 400,
    commandMode: 'button' as 'button' | 'slash',
    commandStart: -1,
    commandEnd: -1,
    permission: DEFAULT_PERMISSION.id,
    permissionLabel: DEFAULT_PERMISSION.label,
    planMode: false,
    goal: '',
    dialogPlaceholder: '输入会话标题',
    riskAck: false,
    feedbackRatings: {} as Record<string, string>,
    feedbackVisible: false,
    feedbackRating: 'positive',
    feedbackTarget: '',
  },

  onLoad() {
    const theme = getTheme()
    applyNavigationBar(theme)
    const model = storage.getModel() ?? DEFAULT_MODEL
    const modelLabel = MODELS.find((item) => item.id === model)?.label ?? MODELS[0]?.label ?? model
    const metrics = getWindowMetrics()
    const isWide = isWideLayout(metrics.width)
    const permission = permissionOf(storage.getPermission())
    const goal = storage.getGoal() ?? ''
    const planMode = storage.getPlanMode() === true
    this.setData({
      theme,
      ...layoutData(metrics),
      ...placeholderData(isWide, planMode),
      isWide,
      model,
      modelLabel,
      permission: permission.id,
      permissionLabel: permission.label,
      planMode,
      goal,
      feedbackRatings: storage.getFeedbackRatings(),
    })

    void sessionStore.init()
    if (unsubscribe !== undefined) unsubscribe()
    unsubscribe = sessionStore.subscribe((state) => this.apply(state))

    if (runClock !== undefined) clearInterval(runClock)
    runClock = setInterval(() => {
      const running = this.data.state.current?.status === 'running' || this.data.state.streaming !== undefined
      if (!running) return
      const startedAt = this.data.runStartedAt === 0 ? Date.now() : this.data.runStartedAt
      const label = `深度求索中，用时 ${formatRunDuration(Date.now() - startedAt)} ···`
      if (startedAt !== this.data.runStartedAt) this.setData({ runStartedAt: startedAt, runLabel: label })
      else if (label !== this.data.runLabel) this.setData({ runLabel: label })
    }, 1000)

    resizeHandler = (result) => {
      const metrics = getWindowMetrics()
      const wide = result.size.windowWidth >= 768
      this.setData({
        ...layoutData(metrics),
        ...placeholderData(wide, this.data.planMode),
        isWide: wide,
        sidebarOpen: wide ? false : this.data.sidebarOpen,
      }, () => {
        this.measureChatViewport()
        if (this.data.modelPickerVisible) this.placeModelPicker()
        if (this.data.commandMenuVisible) this.showCommandMenu()
        if (this.data.menuVisible && this.data.menuContext === 'permission') this.placePermissionMenu()
      })
    }
    wx.onWindowResize(resizeHandler)
  },

  onReady() {
    this.measureChatViewport()
  },

  measureChatViewport() {
    this.createSelectorQuery()
      .select('#chat-scroll')
      .boundingClientRect((rect) => {
        if (rect !== null) this.setData({ chatViewportHeight: (rect as WechatMiniprogram.BoundingClientRectCallbackResult).height })
      })
      .exec()
  },

  onChatScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const viewport = this.data.chatViewportHeight
    if (viewport <= 0) return
    const distance = event.detail.scrollHeight - (event.detail.scrollTop + viewport)
    const atTail = distance <= 48
    if (atTail !== this.data.atTail) this.setData({ atTail })
  },

  scrollToBottom() {
    const state = this.data.state
    const items = this.data.displayItems
    const last = items[items.length - 1]
    const busy = state.current?.status === 'running' || state.streaming !== undefined
    const target = busy ? 'stream-anchor' : last === undefined ? '' : `msg-${last.id}`
    this.setData({ atTail: true, scrollTarget: '' }, () => {
      this.setData({ scrollTarget: target })
    })
  },

  onShow() {
    const theme = getTheme()
    if (theme !== this.data.theme) {
      applyNavigationBar(theme)
      this.setData({ theme })
    }
    const runtimeLabel = sessionStore.runtimeLabel()
    const nanoConnected = nanoRuntime.isAvailable()
    const model = storage.getModel() ?? this.data.model
    const modelLabel = MODELS.find((item) => item.id === model)?.label ?? model
    const permission = permissionOf(storage.getPermission())
    const goal = storage.getGoal() ?? ''
    if (
      model !== this.data.model
      || modelLabel !== this.data.modelLabel
      || runtimeLabel !== this.data.runtimeLabel
      || permission.id !== this.data.permission
      || goal !== this.data.goal
      || (storage.getPlanMode() === true) !== this.data.planMode
    ) {
      this.setData({
        model,
        modelLabel,
        runtimeLabel,
        nanoConnected,
        permission: permission.id,
        permissionLabel: permission.label,
        goal,
        planMode: storage.getPlanMode() === true,
        ...placeholderData(this.data.isWide, storage.getPlanMode() === true),
      })
    }
  },

  onUnload() {
    unsubscribe?.()
    unsubscribe = undefined
    if (runClock !== undefined) {
      clearInterval(runClock)
      runClock = undefined
    }
    if (resizeHandler !== undefined) {
      wx.offWindowResize(resizeHandler)
      resizeHandler = undefined
    }
  },

  apply(state: UiState) {
    const currentId = state.current?.sessionId ?? ''
    const summary = state.sessions.find((session) => session.id === currentId)
    const rows = filterRows(state.sessions, this.data.query)
    const items = state.current?.items ?? []
    const busy = state.current?.status === 'running' || state.streaming !== undefined
    const sessionChanged = currentId !== this.data.currentId
    const collapsedTurns = sessionChanged ? {} : this.data.collapsedTurns
    const atTail = sessionChanged ? true : this.data.atTail
    const turns = buildTurns(items, busy, collapsedTurns)
    const last = turns.items[turns.items.length - 1]
    const scrollTarget = !atTail
      ? this.data.scrollTarget
      : busy
        ? 'stream-anchor'
        : last === undefined
          ? ''
          : `msg-${last.id}`
    const running = state.current?.status === 'running' || state.streaming !== undefined
    const runStartedAt = running
      ? this.data.runStartedAt === 0 ? Date.now() : this.data.runStartedAt
      : 0
    const runLabel = runStartedAt === 0
      ? '深度求索中'
      : `深度求索中，用时 ${formatRunDuration(Date.now() - runStartedAt)} ···`
    this.setData({
      state,
      currentId,
      runtimeLabel: sessionStore.runtimeLabel(),
      title: summary?.title ?? '新会话',
      rows,
      collapsedTurns,
      atTail,
      scrollTarget,
      approval: state.approvals[0] ?? null,
      question: state.questions[0] ?? null,
      showHero: state.current === undefined
        ? !state.loadingSessions && !state.loadingSession
        : items.length === 0 && state.streaming === undefined && !state.loadingSession,
      displayItems: turns.items,
      turnMarks: turns.marks,
      runStartedAt,
      runLabel,
    })
  },

  onComposerInput(event: WechatMiniprogram.CustomEvent<{ value: string; cursor?: number }>) {
    const value = event.detail.value
    const cursor = event.detail.cursor ?? value.length
    this.setData({ input: value })
    const before = value.slice(0, cursor)
    const match = /(^|\s)\/([^\s]*)$/.exec(before)
    if (match !== null) {
      const query = match[2] ?? ''
      const start = cursor - query.length - 1
      this.setData({
        commandMode: 'slash',
        commandMenuQuery: query,
        commandStart: start,
        commandEnd: cursor,
      })
      this.showCommandMenu()
      return
    }
    if (this.data.commandMenuVisible && this.data.commandMode === 'slash') {
      this.setData({ commandMenuVisible: false })
    }
  },

  onSearch(event: WechatMiniprogram.Input) {
    const query = event.detail.value
    this.setData({ query, rows: filterRows(this.data.state.sessions, query) })
  },

  async send() {
    const text = this.data.input.trim()
    const images = this.data.pendingImages
    if (text.length === 0 && images.length === 0) return
    if (text.startsWith('/') && images.length === 0) {
      if (this.data.commandMenuVisible && this.data.commandMode === 'slash' && /^\/[^\s]*$/.test(text)) {
        const command = firstCommand(text.slice(1))
        if (command !== undefined) {
          this.setData({ input: '', commandMenuVisible: false })
          void this.executeCommand(command.id)
          return
        }
      }
      const handled = this.runSlashLine(text)
      if (handled) {
        this.setData({ input: '', pendingImages: [], sidebarOpen: false })
        return
      }
    }
    this.setData({ atTail: true })
    const accepted = await sessionStore.prompt(text, images)
    if (accepted) this.setData({ input: '', pendingImages: [], sidebarOpen: false, commandMenuVisible: false })
  },

  measureComposer(callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
    const composer = this.selectComponent('#composer') as { measure?: (cb: typeof callback) => void } | null
    if (composer?.measure !== undefined) {
      composer.measure(callback)
      return
    }
    this.createSelectorQuery()
      .select('#composer-anchor')
      .boundingClientRect((rect) => {
        callback(rect === null ? null : rect as WechatMiniprogram.BoundingClientRectCallbackResult)
      })
      .exec()
  },

  showCommandMenu(hideKeyboard = false) {
    if (hideKeyboard) wx.hideKeyboard()
    const place = () => this.placeCommandMenu()
    if (hideKeyboard) setTimeout(place, 60)
    else place()
  },

  placeCommandMenu() {
    const metrics = getWindowMetrics()
    const width = Math.min(560, metrics.width - 16)
    this.measureComposer((rect) => {
        const anchor = rect
        const cardWidth = Math.min(width, anchor?.width ?? width)
        const left = Math.max(8, Math.min(metrics.width - cardWidth - 8, anchor?.left ?? 8))
        const cardTop = anchor?.top ?? metrics.height - 96
        const bottom = Math.max(8, metrics.height - cardTop + 4)
        const maxHeight = Math.max(120, Math.min(400, cardTop - metrics.statusBarHeight - metrics.navBarContentHeight - 92))
        this.setData({
          commandMenuVisible: true,
          commandMenuMaxHeight: maxHeight,
          commandMenuStyle: `left: ${left}px; bottom: ${bottom}px; width: ${cardWidth}px; max-height: ${maxHeight + 8}px;`,
        })
    })
  },

  closeCommandMenu() {
    this.setData({ commandMenuVisible: false })
  },

  toggleTurn(event: WechatMiniprogram.TouchEvent) {
    const turn = Number(event.currentTarget.dataset.turn)
    if (!Number.isFinite(turn) || turn <= 0) return
    const collapsedTurns = { ...this.data.collapsedTurns, [turn]: this.data.collapsedTurns[turn] !== true }
    this.setData({ collapsedTurns })
  },

  openCommandMenu() {
    if (this.data.commandMenuVisible && this.data.commandMode === 'button') {
      this.setData({ commandMenuVisible: false })
      return
    }
    this.setData({
      commandMode: 'button',
      commandMenuQuery: '',
      commandStart: -1,
      commandEnd: -1,
    })
    this.showCommandMenu(true)
  },

  onCommandSelect(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    this.setData({ commandMenuVisible: false })
    if (this.data.commandMode === 'slash' && this.data.commandStart >= 0) {
      const input = this.data.input
      const next = input.slice(0, this.data.commandStart) + input.slice(this.data.commandEnd)
      this.setData({ input: next, commandStart: -1, commandEnd: -1 })
    }
    void this.executeCommand(event.detail.id)
  },

  async executeCommand(id: string) {
    if (id === 'file') {
      await this.attach()
      return
    }
    if (id === 'model') {
      this.openModelPicker()
      return
    }
    if (id === 'permission') {
      this.openPermissionMenu()
      return
    }
    if (id === 'goal') {
      this.openGoalDialog()
      return
    }
    if (id === 'feedback') {
      this.openFeedbackDialog()
      return
    }
    if (id === 'plan') {
      this.togglePlanMode()
      return
    }
    if (id === 'compact') {
      this.showToast('当前运行时暂不支持压缩对话', 'info')
      return
    }
    if (id === 'export') {
      this.exportTranscript()
    }
  },

  runSlashLine(line: string): boolean {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(line)
    if (match === null) return false
    const token = (match[1] ?? '').toLowerCase()
    const arg = (match[2] ?? '').trim()
    const id = SLASH_ALIASES[token]
    if (id === undefined) return false
    if (id === 'goal' && arg.length > 0) {
      this.saveGoal(arg)
      return true
    }
    if (id === 'feedback' && arg.length > 0) {
      this.saveFeedback(arg)
      return true
    }
    void this.executeCommand(id)
    return true
  },

  togglePlanMode() {
    const planMode = !this.data.planMode
    storage.setPlanMode(planMode)
    this.setData({ planMode, ...placeholderData(this.data.isWide, planMode) })
    this.showToast(planMode ? '已进入计划模式' : '已退出计划模式', 'success')
  },

  openGoalDialog() {
    this.setData({
      dialogVisible: true,
      dialogAction: 'goal',
      dialogTargetId: '',
      dialogTitle: '设置目标',
      dialogDescription: '目标用于长期任务。输入新的目标，或留空清除当前目标。',
      dialogValue: this.data.goal,
      dialogEditable: true,
      dialogTone: 'default',
      dialogDanger: false,
      dialogConfirmText: '保存目标',
      dialogPlaceholder: '描述目标',
    })
  },

  openFeedbackDialog() {
    this.setData({
      dialogVisible: true,
      dialogAction: 'feedback',
      dialogTargetId: '',
      dialogTitle: '发送反馈',
      dialogDescription: '反馈会记录在当前会话。',
      dialogValue: '',
      dialogEditable: true,
      dialogTone: 'default',
      dialogDanger: false,
      dialogConfirmText: '发送',
      dialogPlaceholder: '描述你的反馈',
    })
  },

  saveGoal(value: string) {
    const goal = value.trim()
    storage.setGoal(goal)
    this.setData({ goal })
    this.showToast(goal.length === 0 ? '目标已清除' : '目标已保存', 'success')
  },

  onGoalEdit(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const goal = event.detail.value.trim()
    if (goal.length === 0) return
    storage.setGoal(goal)
    this.setData({ goal })
  },

  onGoalClear() {
    storage.setGoal('')
    this.setData({ goal: '' })
  },

  saveFeedback(value: string) {
    const text = value.trim()
    if (text.length === 0) return
    storage.addFeedback(text)
    this.showToast('反馈已记录', 'success')
  },

  exportTranscript() {
    const items = this.data.state.current?.items ?? []
    const text = items.map((item) => {
      if (item.kind === 'user_message') return `[用户] ${item.text}`
      if (item.kind === 'assistant_message') return `[助手] ${item.text}`
      if (item.kind === 'tool_call') return `[工具] ${item.tool} (${item.status})`
      if (item.kind === 'tool_result') return `[结果] ${item.summary}`
      if (item.kind === 'notice') return `[系统] ${item.text}`
      return `[差异] ${item.path} ${item.summary}`
    }).join('\n\n')
    wx.setClipboardData({
      data: text,
      success: () => this.showToast('会话内容已复制到剪贴板', 'success'),
      fail: () => this.showToast('复制会话内容失败', 'error'),
    })
  },

  openAutoPermissionDialog(permission: PermissionOption) {
    this.setData({
      dialogVisible: true,
      dialogAction: 'permission-auto',
      dialogTargetId: permission.id,
      dialogTitle: '启用自动审查？',
      dialogDescription: '自动审查是实验性权限：由策略自动判定工具调用是否放行，可能执行你未逐条确认的操作。',
      dialogValue: '',
      dialogEditable: false,
      dialogTone: 'warning',
      dialogDanger: true,
      dialogConfirmText: '启用',
      dialogPlaceholder: '',
      riskAck: false,
    })
  },

  openPermissionMenu() {
    wx.hideKeyboard()
    setTimeout(() => this.placePermissionMenu(), 60)
  },

  measurePermissionTrigger(callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
    const composer = this.selectComponent('#composer') as { measurePermission?: (cb: typeof callback) => void } | null
    if (composer?.measurePermission !== undefined) {
      composer.measurePermission(callback)
      return
    }
    callback(null)
  },

  placePermissionMenu() {
    const items = PERMISSIONS.map((permission) => ({
      id: permission.id,
      label: permission.label,
      description: permission.description,
      badge: permission.badge,
      checked: permission.id === this.data.permission,
    }))
    this.measurePermissionTrigger((trigger) => {
      this.measureComposer((anchor) => {
        const metrics = getWindowMetrics()
        const width = 244
        const left = Math.max(8, Math.min(
          metrics.width - width - 8,
          trigger === null ? (anchor?.left ?? 12) + 8 : trigger.left,
        ))
        const height = 8 + 20 + items.length * 48 + 4
        const triggerTop = trigger === null ? anchor?.top ?? metrics.height - 96 : trigger.top
        const top = Math.max(metrics.statusBarHeight + metrics.navBarContentHeight + 8, triggerTop - height - 6)
        this.setData({
          menuVisible: true,
          menuItems: items,
          menuTitle: '权限',
          menuStyle: `left: ${left}px; top: ${top}px; width: ${width}px;`,
          menuContext: 'permission',
          menuTargetId: this.data.permission,
        })
      })
    })
  },

  stop() {
    void sessionStore.cancel()
  },

  async attach() {
    const image = await pickImage()
    if (image === undefined) return
    this.setData({ pendingImages: [...this.data.pendingImages, image] })
  },

  removeImage(event: WechatMiniprogram.CustomEvent<{ index: number }>) {
    this.setData({ pendingImages: this.data.pendingImages.filter((_image, index) => index !== event.detail.index) })
  },

  async newSession() {
    await sessionStore.create()
    this.setData({ sidebarOpen: false, view: 'chat' })
  },

  async openSession(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '')
    if (id.length === 0 || id === this.data.currentId) {
      this.setData({ sidebarOpen: false })
      return
    }
    await sessionStore.open(id)
    this.setData({ sidebarOpen: false, view: 'chat' })
    if (this.data.rightOpen) void this.refreshRightPanel()
  },

  switchView(event: WechatMiniprogram.TouchEvent) {
    const view = String(event.currentTarget.dataset.view ?? 'chat') as 'chat' | 'trajectory'
    this.setData({ view })
  },

  jumpToTurn(event: WechatMiniprogram.TouchEvent) {
    const target = String(event.currentTarget.dataset.target ?? '')
    if (target.length === 0) return
    this.setData({ scrollTarget: target })
  },

  toggleSidebar() {
    this.setData({ sidebarOpen: !this.data.sidebarOpen })
  },

  closeSidebar() {
    this.setData({ sidebarOpen: false })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  openAccountSettings() {
    wx.navigateTo({ url: '/pages/settings/settings?section=account' })
  },

  toggleRightPanel() {
    const rightOpen = !this.data.rightOpen
    this.setData({ rightOpen })
    if (rightOpen) void this.refreshRightPanel()
  },

  closeRightPanel() {
    this.setData({ rightOpen: false })
  },

  selectRightTab(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    this.setData({ rightTab: event.detail.id })
    void this.refreshRightPanel()
  },

  async refreshRightPanel() {
    const sessionId = this.data.currentId
    const tab = this.data.rightTab
    if (!this.data.nanoConnected || sessionId.length === 0 || (tab !== 'files' && tab !== 'plan')) {
      this.setData({ rightLoading: false, rightError: '' })
      return
    }
    this.setData({ rightLoading: true, rightError: '' })
    try {
      if (tab === 'files') {
        const data = await fetchWorkspaceFiles(sessionId)
        this.setData({
          rightFiles: (data.files ?? []).map((file) => ({
            path: file.virtual_path,
            size: formatSize(file.size_bytes),
            mime: file.mime ?? '',
          })),
        })
      } else {
        const data = await fetchTodos(sessionId)
        this.setData({
          rightTodos: (data.todos ?? []).map((todo) => ({
            id: todo.todo_uuid,
            content: todo.content,
            status: todo.status,
          })),
        })
      }
    } catch (error) {
      this.setData({ rightError: error instanceof Error ? error.message : '加载失败' })
    } finally {
      this.setData({ rightLoading: false })
    }
  },

  openModelPicker() {
    wx.hideKeyboard()
    setTimeout(() => this.placeModelPicker(), 60)
  },

  measureModelTrigger(callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
    const composer = this.selectComponent('#composer') as { measureModel?: (cb: typeof callback) => void } | null
    if (composer?.measureModel !== undefined) {
      composer.measureModel(callback)
      return
    }
    callback(null)
  },

  placeModelPicker() {
    const metrics = getWindowMetrics()
    const width = 260
    const height = 8 + 27 + this.data.models.length * 44
    this.measureModelTrigger((trigger) => {
      this.measureComposer((anchor) => {
        // 菜单右缘对齐模型触发键，底边距触发键顶部 8px；测量失败时回退到 composer 几何。
        const right = trigger === null
          ? anchor === null ? metrics.width - 12 : anchor.right - 54
          : trigger.right
        const left = Math.max(8, Math.min(metrics.width - width - 8, right - width))
        const buttonTop = trigger === null
          ? anchor === null ? metrics.height - 96 : anchor.bottom - 42
          : trigger.top
        const top = Math.max(metrics.statusBarHeight + metrics.navBarContentHeight + 8, buttonTop - 8 - height)
        this.setData({
          modelPickerVisible: true,
          modelPickerStyle: `left: ${left}px; top: ${top}px; width: ${width}px;`,
        })
      })
    })
  },

  closeModelPicker() {
    this.setData({ modelPickerVisible: false })
  },

  onModelSelect(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const model = event.detail.id
    const modelLabel = MODELS.find((item) => item.id === model)?.label ?? model
    storage.setModel(model)
    this.setData({ model, modelLabel, modelPickerVisible: false })
  },

  onApprovalRespond(event: WechatMiniprogram.CustomEvent<{ approvalId: string; outcome: ApprovalOutcome }>) {
    void sessionStore.answerApproval(event.detail.approvalId, event.detail.outcome)
  },

  onQuestionSubmit(event: WechatMiniprogram.CustomEvent<{ questionId: string; answers: QuestionAnswer[] }>) {
    void sessionStore.answerQuestion(event.detail.questionId, event.detail.answers)
  },

  onQuestionClose() {
    const question = this.data.question
    if (question !== null) sessionStore.dismissQuestion(question.id)
  },

  openWorkspaceMenu() {
    const selector = this.data.showHero ? '#workspace-menu-button' : '#workspace-menu-button-sidebar'
    this.openMenu(selector, 'workspace', '', WORKSPACE_MENU, '工作区')
  },

  onSessionMenu(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '')
    if (id.length === 0) return
    this.openMenu(`#session-more-${id}`, 'session', id, SESSION_MENU)
  },

  openHeaderSessionMenu() {
    if (this.data.currentId.length === 0) return
    this.openMenu('#header-session-menu', 'header-session', this.data.currentId, SESSION_MENU)
  },

  openMenu(anchorSelector: string, context: MenuContext, targetId: string, items: MenuItem[], title = '') {
    const show = (anchor?: WechatMiniprogram.BoundingClientRectCallbackResult) => {
      const metrics = getWindowMetrics()
      const width = 176
      const height = 8 + items.length * 34 + (title.length > 0 ? 20 : 0)
      let left = metrics.width - width - 8
      let top = metrics.statusBarHeight + metrics.navBarContentHeight + 8
      if (anchor !== undefined) {
        left = Math.max(8, Math.min(metrics.width - width - 8, anchor.right - width))
        top = anchor.bottom + 4
        if (top + height > metrics.height - 12) {
          top = Math.max(metrics.statusBarHeight + metrics.navBarContentHeight + 8, anchor.top - height - 4)
        }
      }
      this.setData({
        menuVisible: true,
        menuItems: items,
        menuTitle: title,
        menuStyle: `left: ${left}px; top: ${top}px; width: ${width}px;`,
        menuContext: context,
        menuTargetId: targetId,
      })
    }
    this.createSelectorQuery()
      .select(anchorSelector)
      .boundingClientRect((rect) => {
        show(rect === null ? undefined : rect as WechatMiniprogram.BoundingClientRectCallbackResult)
      })
      .exec()
  },

  closeMenu() {
    this.setData({ menuVisible: false })
  },

  onMenuSelect(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = event.detail.id
    const context = this.data.menuContext
    const targetId = this.data.menuTargetId
    this.setData({ menuVisible: false })
    if (context === 'workspace') {
      if (id === 'new-session') void this.newSession()
      if (id === 'settings') this.openSettings()
      return
    }
    if (context === 'permission') {
      const permission = PERMISSIONS.find((item) => item.id === id)
      if (permission !== undefined) {
        if (permission.id === 'auto' && this.data.permission !== 'auto') {
          this.openAutoPermissionDialog(permission)
          return
        }
        storage.setPermission(permission.id)
        this.setData({ permission: permission.id, permissionLabel: permission.label })
        this.showToast(`权限已切换为${permission.label}`, 'success')
      }
      return
    }
    if (targetId.length === 0) return
    if (id === 'rename') this.openRenameDialog(targetId)
    if (id === 'delete') this.openDeleteDialog(targetId)
  },

  openRenameDialog(id: string) {
    const current = this.data.state.sessions.find((session) => session.id === id)
    this.setData({
      dialogVisible: true,
      dialogAction: 'rename',
      dialogTargetId: id,
      dialogTitle: '重命名会话',
      dialogDescription: '',
      dialogValue: current?.title ?? '',
      dialogEditable: true,
      dialogTone: 'default',
      dialogDanger: false,
      dialogConfirmText: '重命名',
      dialogPlaceholder: '输入会话标题',
    })
  },

  openDeleteDialog(id: string) {
    this.setData({
      dialogVisible: true,
      dialogAction: 'delete',
      dialogTargetId: id,
      dialogTitle: '删除会话',
      dialogDescription: '删除后无法恢复，确定继续吗？',
      dialogValue: '',
      dialogEditable: false,
      dialogTone: 'warning',
      dialogDanger: true,
      dialogConfirmText: '删除',
      dialogPlaceholder: '输入会话标题',
    })
  },

  closeDialog() {
    this.setData({ dialogVisible: false })
  },

  onMessageFeedback(event: WechatMiniprogram.CustomEvent<{ messageId: string; rating: string }>) {
    const messageId = event.detail.messageId
    if (messageId.length === 0) return
    const current = this.data.feedbackRatings[messageId] ?? ''
    if (current === event.detail.rating) {
      storage.setFeedbackRating(messageId, '')
      this.setData({ [`feedbackRatings.${messageId}`]: '' })
      return
    }
    this.setData({
      feedbackVisible: true,
      feedbackRating: event.detail.rating,
      feedbackTarget: messageId,
    })
  },

  closeFeedback() {
    this.setData({ feedbackVisible: false })
  },

  onFeedbackSubmit(event: WechatMiniprogram.CustomEvent<{ rating: string; category: string; text: string }>) {
    const { rating, category, text } = event.detail
    const messageId = this.data.feedbackTarget
    storage.addFeedback(text, { rating, category, messageId })
    if (messageId.length > 0) {
      storage.setFeedbackRating(messageId, rating)
      this.setData({ [`feedbackRatings.${messageId}`]: rating })
    }
    this.setData({ feedbackVisible: false })
    this.showToast('感谢你的反馈', 'success')
  },

  onRiskAck(event: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.setData({ riskAck: event.detail.checked })
  },

  onDialogConfirm(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const id = this.data.dialogTargetId
    const action = this.data.dialogAction
    if (action === 'goal') {
      this.saveGoal(String(event.detail.value ?? ''))
      this.closeDialog()
      return
    }
    if (action === 'feedback') {
      this.saveFeedback(String(event.detail.value ?? ''))
      this.closeDialog()
      return
    }
    if (action === 'permission-auto') {
      if (!this.data.riskAck) return
      const permission = PERMISSIONS.find((item) => item.id === id)
      if (permission !== undefined) {
        storage.setPermission(permission.id)
        this.setData({ permission: permission.id, permissionLabel: permission.label })
        this.showToast(`权限已切换为${permission.label}`, 'success')
      }
      this.closeDialog()
      return
    }
    if (action === 'rename') {
      const title = String(event.detail.value ?? '').trim()
      if (title.length === 0 || id.length === 0) return
      if (this.data.currentId === id) void sessionStore.rename(title)
      else void sessionStore.open(id).then(() => sessionStore.rename(title))
    }
    if (action === 'delete' && id.length > 0) void sessionStore.remove(id)
    this.closeDialog()
  },

  showToast(message: string, tone = 'info') {
    this.setData({ toastVisible: true, toastMessage: message, toastTone: tone })
  },

  closeToast() {
    this.setData({ toastVisible: false })
  },

  branchMessage() {
    this.showToast('分支需要 dsh Host 的 session/fork', 'info')
  },

  dismissError() {
    sessionStore.dismissError()
  },
})

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function layoutData(metrics: WindowMetrics) {
  return {
    statusBarHeight: metrics.statusBarHeight,
    navBarContentHeight: metrics.navBarContentHeight,
    capsuleInsetRight: metrics.capsuleInsetRight,
    windowWidth: metrics.width,
    appStyle: [
      `--app-status-bar: ${metrics.statusBarHeight}px`,
      `--app-nav-height: ${metrics.statusBarHeight + metrics.navBarContentHeight}px`,
      `--app-capsule-right: ${metrics.capsuleInsetRight}px`,
      `--app-safe-bottom: ${metrics.safeAreaBottom}px`,
    ].join('; '),
  }
}

function formatRunDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
  if (total >= 60) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

function filterRows(sessions: SessionSummary[], query: string): SessionRow[] {
  const keyword = query.trim().toLowerCase()
  return sessions
    .filter((session) => {
      if (keyword.length === 0) return true
      return session.title.toLowerCase().includes(keyword)
        || (session.lastMessage ?? '').toLowerCase().includes(keyword)
    })
    .map((session) => ({ ...session, timeLabel: formatRelative(session.updatedAt) }))
}

interface TurnMeta {
  headerIndex: number
  start: number
  end: number
  hasContent: boolean
  failed: boolean
}

function buildTurns(
  items: ChatItem[],
  live: boolean,
  collapsedTurns: Record<number, boolean>,
): { items: DisplayItem[]; marks: TurnMark[] } {
  const display: DisplayItem[] = []
  const marks: TurnMark[] = []
  const metas: TurnMeta[] = []
  const toolRows = new Map<string, number[]>()
  let turn = 0
  let awaitingHeader = false

  const push = (entry: DisplayItem): void => {
    const meta = metas[metas.length - 1]
    if (meta !== undefined && entry.ts !== undefined && entry.ts > meta.end) meta.end = entry.ts
    const process = entry.kind === 'tool_call' || entry.kind === 'tool_result'
    if (meta !== undefined && process) meta.hasContent = true
    if (meta !== undefined && entry.kind === 'notice' && entry.level === 'error') meta.failed = true
    entry = { ...entry, turn, process }
    if (awaitingHeader) {
      awaitingHeader = false
      if (meta !== undefined) meta.headerIndex = display.length
      display.push(entry)
      if (entry.kind === 'assistant_message' && marks.length > 0) {
        const mark = marks[marks.length - 1]
        if (mark !== undefined) mark.label = entry.text.slice(0, 48)
      }
      return
    }
    display.push(entry)
  }

  for (const item of items) {
    if (item.kind === 'user_message') {
      turn += 1
      awaitingHeader = true
      toolRows.clear()
      metas.push({ headerIndex: -1, start: item.ts ?? 0, end: item.ts ?? 0, hasContent: false, failed: false })
      marks.push({
        turn,
        target: `msg-${item.id}`,
        label: item.text.slice(0, 48),
        active: false,
      })
      display.push(item)
      continue
    }
    if (item.kind === 'tool_call') {
      const pending = toolRows.get(item.tool) ?? []
      pending.push(display.length)
      toolRows.set(item.tool, pending)
      push({ ...item, toolView: toolView(item) })
      continue
    }
    if (item.kind === 'tool_result') {
      const pending = toolRows.get(item.tool)
      const index = pending?.shift()
      if (pending !== undefined && pending.length === 0) toolRows.delete(item.tool)
      if (index !== undefined) {
        const call = display[index]
        if (call !== undefined && call.kind === 'tool_call') {
          const merged: DisplayItem = {
            ...call,
            status: item.status,
            detail: item.detail ?? call.detail,
            ts: call.ts ?? item.ts,
          }
          display[index] = { ...merged, process: call.process, turn: call.turn, toolView: toolView(merged) }
          const meta = metas[metas.length - 1]
          if (meta !== undefined && item.ts !== undefined && item.ts > meta.end) meta.end = item.ts
          continue
        }
      }
    }
    push(item.kind === 'tool_result' ? { ...item, toolView: toolView(item) } : item)
  }
  metas.forEach((meta, index) => {
    if (meta.headerIndex < 0) return
    if (live && index === metas.length - 1) return
    const entry = display[meta.headerIndex]
    if (entry === undefined) return
    const label = meta.failed
      ? '处理失败'
      : meta.start > 0 && meta.end >= meta.start
        ? `已完成，用时 ${formatRunDuration(Math.max(1000, meta.end - meta.start))}`
        : '已完成'
    const collapsed = collapsedTurns[index + 1] === true && meta.hasContent && !meta.failed
    display[meta.headerIndex] = {
      ...entry,
      turn: index + 1,
      turnLabel: label,
      turnCollapsible: meta.hasContent && !meta.failed,
      processHidden: collapsed && entry.process === true,
    }
    if (collapsed) {
      for (let row = meta.headerIndex; row < display.length; row += 1) {
        const candidate = display[row]
        if (candidate?.process === true) display[row] = { ...candidate, processHidden: true }
      }
    }
  })
  const last = marks[marks.length - 1]
  if (last !== undefined) last.active = true
  return { items: display, marks }
}
