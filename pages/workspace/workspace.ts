import { sessionStore } from '../../services/session-store'
import { vfs, vfsStore } from '../../services/vfs/api'
import { nanoRuntime } from '../../services/nano/runtime'
import { fxRuntime } from '../../services/fx/runtime'
import { fetchTodos, fetchWorkspaceFiles } from '../../services/nano/http'
import { pickImage } from '../../services/upload'
import { APP_VERSION, DEFAULT_MODEL, MODELS, type ModelOption } from '../../services/config'
import { applyNavigationBar, getTheme, type Theme } from '../../services/theme'
import { storage } from '../../services/storage'
import { DEFAULT_PERMISSION, PERMISSIONS, permissionOf, type PermissionOption } from '../../services/permissions'
import { classifyError, errorBus, type ErrorReport } from '../../services/error-report'
import { sessionDiagnostics } from '../../services/diagnostics'
import { ensureDurableTicket, remoteDurableActive } from '../../services/state/provider'
import { sessionSyncMap } from '../../services/nano-mini-host/transcript'
import { hasFreshTicket, onTicketMinted } from '../../services/fx/ticket'
import { nanoMiniCatchUp } from '../../services/nano-mini-host/tick'
import { firstCommand } from '../../services/commands'
import {
  engineBadge, engineLabel, magpieAvailable, pendingEngine, routeDefaultEngine, setPendingEngine,
} from '../../services/session-engine'
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
  SessionEngine,
  SessionSummary,
  UiState,
} from '../../types/protocol'

interface SessionRow extends SessionSummary {
  timeLabel: string
  /** local=仅本地 | synced=转录水位覆盖最新 | pending=有远端行但本地更新未上行。 */
  syncState: 'local' | 'synced' | 'pending'
  syncLabel: string
  /** 引擎戳记徽标（本地·nano-agent / 本地·magpie / 云端）。 */
  engineBadge: string
}

/* Tool rows carry their dsh presentation projection (utils/tool-view). */
type DisplayItem = ChatItem & {
  turn?: number
  turnLabel?: string
  turnCollapsible?: boolean
  turnCollapsed?: boolean
  process?: boolean
  processHidden?: boolean
  messageActions?: boolean
  running?: boolean
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
  checked?: boolean
  disabled?: boolean
  description?: string
  badge?: string
}

type MenuContext = 'session' | 'workspace' | 'header-session' | 'permission'
type DialogAction = 'rename' | 'delete' | 'goal' | 'permission-auto'


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
  { id: 'diagnostics', label: '诊断', icon: 'info-outline' },
  { id: 'delete', label: '删除会话', icon: 'trash-outline', danger: true },
]

interface EngineOption {
  id: SessionEngine
  label: string
  icon: string
  description: string
  checked: boolean
  disabled?: boolean
  badge?: string
}

/** 引擎抽屉选项（业主 MN03）：本地引擎（nano-agent=默认，magpie=dev 指针
 *  在位才出现）+ 云端引擎（未适配仅展示）。勾选=下一次建会话的 runtime，
 *  持久跨启动——会话行徽标与诊断面同真源。 */
function buildEngineOptions(): EngineOption[] {
  const pending = pendingEngine()
  const options: EngineOption[] = [
    {
      id: 'nano-agent', label: '本地引擎', icon: 'layers-outline',
      checked: pending === 'nano-agent',
      description: '本地运行时 nano-agent，直连你的 BYOK 上游',
    },
  ]
  if (magpieAvailable()) {
    options.push({
      id: 'magpie', label: '本地引擎 · magpie', icon: 'api-outline',
      checked: pending === 'magpie', badge: 'dev',
      description: '本地运行时，走本机 magpie 网关（开发测试）',
    })
  }
  options.push({
    id: 'cloud', label: '云端引擎', icon: 'globe-outline',
    checked: false, disabled: true,
    description: 'nano-agent 云端运行时——未适配，暂不可选',
  })
  return options
}

let unsubscribe: (() => void) | undefined
let unsubscribeErr: (() => void) | undefined
/** 铸票后隐藏解锁横幅（onTicketMinted 无 unsubscribe——模块级绑定一次，由
 *  当前页实例填充）。 */
let refreshUnlockFlag: (() => void) | undefined
let mintListenerBound = false
let resizeHandler: ((result: WechatMiniprogram.OnWindowResizeListenerResult) => void) | undefined
/** 按会话记住折叠的轮次。页面实例在热重载时会被换掉，所以不挂在 this 上。 */
const foldedTurns = new Map<string, Set<number>>()
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
    viewTabs: [
      { id: 'chat', label: '对话' },
      { id: 'trajectory', label: '轨迹' },
    ],
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
    needUnlock: false,
    menuVisible: false,
    menuItems: [] as MenuItem[],
    menuTitle: '',
    menuStyle: '',
    menuContext: 'session' as MenuContext,
    menuTargetId: '',
    engineDrawerVisible: false,
    engineOptions: [] as EngineOption[],
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
    errToasts: [] as ErrorReport[],
    errModal: null as ErrorReport | null,
    errPending: 0,
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
    refreshUnlockFlag = () => this.refreshUnlock()
    if (!mintListenerBound) {
      mintListenerBound = true
      onTicketMinted(() => refreshUnlockFlag?.())
    }
    this.refreshUnlock()
    if (unsubscribe !== undefined) unsubscribe()
    unsubscribe = sessionStore.subscribe((state) => this.apply(state))
    if (unsubscribeErr !== undefined) unsubscribeErr()
    unsubscribeErr = errorBus.subscribe((bus) => this.setData({ errToasts: bus.toasts, errModal: bus.modal ?? null, errPending: bus.pendingCount }))

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
    this.refreshUnlock()
  },

  /** 云 durable 车道无活票据→提示解锁横幅；本地车道/已有票→隐藏（业主 W2 裁决 C 半）。 */
  refreshUnlock() {
    const needUnlock = remoteDurableActive() && !hasFreshTicket()
    if (needUnlock !== this.data.needUnlock) this.setData({ needUnlock })
  },

  /** 横幅点击=用户手势上下文，合规走 challenge→SOTER→unlock 铸票。 */
  async onUnlockSync() {
    try {
      await ensureDurableTicket()
      this.refreshUnlock()
      void nanoMiniCatchUp().catch(() => { /* catchUp 自身兜底 */ })
    } catch (e) {
      errorBus.report(e, { op: 'unlock-sync', lane: 'ui' })
      this.refreshUnlock()
    }
  },

  onUnload() {
    if (refreshUnlockFlag !== undefined) refreshUnlockFlag = undefined
    unsubscribe?.()
    unsubscribe = undefined
    unsubscribeErr?.()
    unsubscribeErr = undefined
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
    const items: DisplayItem[] = [...(state.current?.items ?? [])]
    const stream = state.streaming
    if (stream !== undefined && stream.sessionId === currentId && stream.text.length > 0) {
      // The settled message lands just before `assistant.settle`; until then the
      // delta buffer is the only copy of the streaming reply.
      const lastItem = items[items.length - 1]
      const settled = lastItem?.kind === 'assistant_message' && lastItem.text === stream.text
      if (!settled) {
        items.push({
          id: `stream-${stream.attemptId}`,
          seq: Number.MAX_SAFE_INTEGER,
          kind: 'assistant_message',
          text: stream.text,
          html: '',
          running: true,
        })
      }
    }
    const busy = state.current?.status === 'running' || state.streaming !== undefined
    const sessionChanged = currentId !== this.data.currentId
    const folded = foldedTurns.get(currentId) ?? new Set<number>()
    const atTail = sessionChanged ? true : this.data.atTail
    const turns = buildTurns(items, busy, folded)
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
        modelPickerVisible: false,
        menuVisible: false,
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
    const rawInput = this.data.input
    const text = rawInput.trim()
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
    // await 窗内用户续打的草稿不得清——仅载荷原样未动才清空（铸票/图片
    // 解析可达秒级，窗真实存在）。
    if (accepted && this.data.input === rawInput && this.data.pendingImages === images) {
      this.setData({ input: '', pendingImages: [], sidebarOpen: false, commandMenuVisible: false })
    }
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
    const sessionId = this.data.currentId
    const folded = foldedTurns.get(sessionId) ?? new Set<number>()
    const header = (this.data.displayItems as DisplayItem[]).find((item) => item.turn === turn && item.turnLabel !== undefined)
    const collapsed = header?.turnCollapsed === true
    if (collapsed) folded.delete(turn)
    else folded.add(turn)
    foldedTurns.set(sessionId, folded)
    this.apply(this.data.state)
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
      modelPickerVisible: false,
      menuVisible: false,
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
    // dsh 的同一个表单服务会话反馈与消息赞踩；会话反馈不带评分。
    this.setData({
      feedbackVisible: true,
      feedbackRating: '',
      feedbackTarget: 'session',
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
      fail: (err) => errorBus.report(err, { op: 'clipboard', lane: 'ui' }),
    })
  },

  /** G2：session workspace 诊断按钮——bundle 落 vfs + 全文复制剪贴板。
   *  与 globalData.__diagnostics（devtools MCP/automator evaluate 面）同一真源。 */
  exportDiagnostics(sessionId: string) {
    try {
      const bundle = sessionDiagnostics(sessionId.length > 0 ? sessionId : undefined)
      const text = JSON.stringify(bundle, null, 2)
      const path = `/root/diagnostics/${bundle.session?.id ?? 'app'}-${bundle.ts}.json`
      vfs.write(path, text, { sessionId: sessionId.length > 0 ? sessionId : 'diagnostics', mime: 'application/json' })
      wx.setClipboardData({
        data: text,
        success: () => this.showToast(`诊断已复制（已存 ${path}）`, 'success'),
        fail: () => this.showToast(`诊断已存 ${path}，复制失败`, 'error'),
      })
    } catch (error) {
      errorBus.report(error, { op: 'diagnostics', lane: 'ui', sessionId })
    }
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
    this.setData({ commandMenuVisible: false, modelPickerVisible: false })
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
    try {
      const image = await pickImage()
      if (image === undefined) return
      this.setData({ pendingImages: [...this.data.pendingImages, image] })
    } catch (error) {
      errorBus.report(error, { op: 'attach', lane: 'ui' })
    }
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

  onViewChange(event: WechatMiniprogram.CustomEvent<{ id?: string }>) {
    const view = String(event.detail?.id ?? 'chat') as 'chat' | 'trajectory'
    this.setData({ view })
  },

  inspectToolCall(event: WechatMiniprogram.CustomEvent<{ seq: number }>) {
    const seq = Number(event.detail.seq)
    this.setData({ view: 'trajectory' }, () => {
      setTimeout(() => {
        const trajectory = this.selectComponent('#trajectory') as { focusSeq?: (seq: number) => void } | null
        if (trajectory?.focusSeq !== undefined) trajectory.focusSeq(seq)
      }, 0)
    })
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
    if (tab !== 'files' && tab !== 'plan') {
      this.setData({ rightLoading: false, rightError: '' })
      return
    }
    // local-runtime 车道：files tab 直接渲染本地五根 VFS（含 /mnt 挂载注册表）
    if (tab === 'files' && !this.data.nanoConnected) {
      this.setData({ rightLoading: false, rightError: '', rightFiles: localVfsEntries() })
      return
    }
    if (!this.data.nanoConnected || sessionId.length === 0) {
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
      // 面板内联错误已是专属显示面——入 bus 仅作 silent 台账（不双弹）。
      const report = classifyError(error, { op: 'right-panel', lane: 'ui', sessionId })
      report.surface = 'silent'
      errorBus.report(report)
    } finally {
      this.setData({ rightLoading: false })
    }
  },

  openModelPicker() {
    wx.hideKeyboard()
    this.setData({ commandMenuVisible: false, menuVisible: false })
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
    // fx 车道生效模型在 core 启动时注入 env——不重启则 chip 显示与生效模型
    // 静默不一致（与设置页 selectModel 同构，UI 审查 F9；未启动时为空操作）。
    try {
      fxRuntime.restartCore()
    } catch (error) {
      errorBus.report(error, { op: 'model-switch', lane: 'ui' })
    }
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

  /** 新会话 runtime 选择 → 向上弹窗抽屉 upDrawer（业主 MN03）。 */
  openWorkspaceMenu() {
    this.setData({ engineDrawerVisible: true, engineOptions: buildEngineOptions() })
  },

  closeEngineDrawer() {
    this.setData({ engineDrawerVisible: false })
  },

  onEnginePick(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '') as SessionEngine
    const option = this.data.engineOptions.find((o) => o.id === id)
    if (option === undefined || option.disabled === true) return
    setPendingEngine(id)
    this.setData({ engineDrawerVisible: false })
    this.showToast(`新会话将使用${engineLabel(id)}`, 'success')
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
      // 工作区芯片已改走 upDrawer 引擎抽屉——此分支仅兜历史入口残留。
      if (id === 'new-session') void this.newSession()
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
    if (id === 'diagnostics') this.exportDiagnostics(targetId)
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
    const target = this.data.feedbackTarget
    const sessionTarget = target === 'session'
    storage.addFeedback(text.trim(), {
      ...(sessionTarget || rating.length === 0 ? {} : { rating }),
      ...(category.length === 0 ? {} : { category }),
      ...(sessionTarget ? {} : { messageId: target }),
    })
    if (!sessionTarget && target.length > 0 && rating.length > 0) {
      storage.setFeedbackRating(target, rating)
      this.setData({ [`feedbackRatings.${target}`]: rating })
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
      else void sessionStore.renameById(id, title)
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

  // ── error-center 事件面（MN03 G1）──────────────────────────────

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
})

/** local-runtime 车道的 files tab：五根 + /mnt 挂载 + 本地 VFS 行（按路径序）。 */
function localVfsEntries(): Array<{ path: string; size: string; mime: string }> {
  const entries: Array<{ path: string; size: string; mime: string }> = [
    { path: '/root', size: '', mime: 'dir' },
    { path: '/data', size: '', mime: 'dir' },
    { path: '/mnt', size: '', mime: 'dir' },
    { path: '/tmp', size: '', mime: 'dir' },
    { path: '/backup', size: '', mime: 'dir' },
  ]
  for (const m of vfsStore.allMounts().sort((a, b) => (a.name < b.name ? -1 : 1))) {
    entries.push({ path: `/mnt/${m.name}`, size: `${m.sessions.length} session`, mime: 'mount' })
  }
  for (const row of vfsStore.allRows().sort((a, b) => (a.virtual_path < b.virtual_path ? -1 : 1))) {
    entries.push({ path: row.virtual_path, size: formatSize(row.size_bytes), mime: row.mime ?? '' })
  }
  return entries
}

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
  const syncMap = sessionSyncMap()
  return sessions
    .filter((session) => {
      if (keyword.length === 0) return true
      return session.title.toLowerCase().includes(keyword)
        || (session.lastMessage ?? '').toLowerCase().includes(keyword)
    })
    .map((session) => {
      const ptr = syncMap.get(session.id)
      const syncState = ptr === undefined ? 'local' : ptr.updated_ms >= session.updatedAt ? 'synced' : 'pending'
      const syncLabel = syncState === 'local' ? '本地' : syncState === 'synced' ? '已同步' : '待同步'
      const engine = session.engine ?? routeDefaultEngine()
      return { ...session, timeLabel: formatRelative(session.updatedAt), syncState, syncLabel, engineBadge: engineBadge(engine) }
    })
}

interface TurnMeta {
  headerIndex: number
  startIndex: number
  start: number
  end: number
  hasContent: boolean
  failed: boolean
}

function buildTurns(
  items: ChatItem[],
  live: boolean,
  collapsed: Set<number>,
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
      metas.push({
        headerIndex: -1,
        startIndex: display.length,
        start: item.ts ?? 0,
        end: item.ts ?? 0,
        hasContent: false,
        failed: false,
      })
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
    const folded = collapsed.has(index + 1) && meta.hasContent && !meta.failed
    display[meta.headerIndex] = {
      ...entry,
      turn: index + 1,
      turnLabel: label,
      turnCollapsible: meta.hasContent && !meta.failed,
      turnCollapsed: folded,
      processHidden: folded && entry.process === true,
    }
    const end = metas[index + 1]?.startIndex ?? display.length
    if (folded) {
      for (let row = meta.headerIndex; row < end; row += 1) {
        const candidate = display[row]
        if (candidate?.process === true) display[row] = { ...candidate, processHidden: true }
      }
    }
    // Actions belong to the settled turn tail: the last assistant text of the
    // turn carries them, and a running turn shows none until its closing frame.
    let actionsIndex = -1
    for (let row = meta.headerIndex; row < end; row += 1) {
      if (display[row]?.kind === 'assistant_message') actionsIndex = row
    }
    const actionEntry = display[actionsIndex]
    if (actionsIndex >= 0 && actionEntry !== undefined) {
      display[actionsIndex] = { ...actionEntry, messageActions: true }
    }
  })
  // A reply still arriving is the live step: its reasoning row shimmers until
  // the next tool row or the settled turn takes over.
  const tail = display[display.length - 1]
  if (live && tail?.kind === 'assistant_message') {
    display[display.length - 1] = { ...tail, running: true }
  }
  const last = marks[marks.length - 1]
  if (last !== undefined) last.active = true
  return { items: display, marks }
}
