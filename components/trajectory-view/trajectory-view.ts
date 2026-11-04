import type { ChatItem } from '../../types/protocol'
import {
  buildTrajectoryTimeline,
  buildTrajectoryTurns,
  flattenCells,
  formatClock,
  formatElapsedSeconds,
  searchCell,
  summarizeCallCells,
  summarizeTurnCells,
  type TrajectoryCell,
  type TrajectoryKind,
  type TrajectoryTurn,
} from '../../utils/trajectory'

type RowType = 'cell' | 'collapsed-turn' | 'collapsed-call' | 'turn-header'

interface TrajectoryRow {
  key: string
  type: RowType
  index: number
  kind: TrajectoryKind | 'summary'
  kindLabel: string
  turn: number
  turnLabel: string
  turnStart: boolean
  showRequest: boolean
  requestLabel: string
  text: string
  resultText: string
  isError: boolean
  running: boolean
  selected: boolean
  turnActive: boolean
  timeLabel: string
}

interface TimelineSpanView {
  index: number
  kind: TrajectoryKind
  left: string
  width: string
  lane: number
  selected: boolean
  dimmed: boolean
  isError: boolean
}

interface DetailTab {
  id: 'overview' | 'preview' | 'raw' | 'input' | 'output' | 'thinking' | 'timing'
  label: string
}

interface DetailRow {
  label: string
  value: string
  error?: boolean
}

interface TrajectoryDetail {
  index: number
  kind: TrajectoryKind
  kindLabel: string
  location: string
  status: string
  isError: boolean
  timeLabel: string
  tabs: DetailTab[]
  overview: DetailRow[]
  raw: string
  previewText: string
  input: string
  output: string
  thinking: string
  timing: DetailRow[]
}

const KIND_LABEL: Record<TrajectoryKind, string> = {
  system: '系统',
  user: '用户',
  context: '上下文',
  compacted: '已压缩',
  message: '消息',
  tool: '工具',
  subtool: '子工具',
}

function rowFromCell(
  cell: TrajectoryCell,
  options: {
    turnStart: boolean
    showRequest: boolean
    requestLabel: string
    selected: boolean
    turnActive: boolean
  },
): TrajectoryRow {
  return {
    key: `cell-${cell.index}`,
    type: 'cell',
    index: cell.index,
    kind: cell.kind,
    kindLabel: cell.kindLabel,
    turn: cell.turn,
    turnLabel: `第 ${cell.turn} 轮`,
    turnStart: options.turnStart,
    showRequest: options.showRequest,
    requestLabel: options.requestLabel,
    text: cell.text.length === 0 ? '无内容' : cell.text,
    resultText: cell.resultText ?? '',
    isError: cell.isError,
    running: cell.running,
    selected: options.selected,
    turnActive: options.turnActive,
    timeLabel: formatElapsedSeconds(cell.timeSeconds),
  }
}

function turnHeaderRow(turn: number): TrajectoryRow {
  return {
    key: `turn-header-${turn}`,
    type: 'turn-header',
    index: -1,
    kind: 'summary',
    kindLabel: '',
    turn,
    turnLabel: `第 ${turn} 轮`,
    turnStart: false,
    showRequest: false,
    requestLabel: '',
    text: '',
    resultText: '',
    isError: false,
    running: false,
    selected: false,
    turnActive: false,
    timeLabel: '',
  }
}

function summaryRow(
  key: string,
  type: RowType,
  turn: number,
  text: string,
  turnStart = false,
  turnActive = false,
): TrajectoryRow {
  return {
    key,
    type,
    index: -1,
    kind: 'summary',
    kindLabel: '',
    turn,
    turnLabel: `第 ${turn} 轮`,
    turnStart,
    showRequest: false,
    requestLabel: '',
    text,
    resultText: '',
    isError: false,
    running: false,
    selected: false,
    turnActive,
    timeLabel: '—',
  }
}

Component({
  properties: {
    theme: { type: String, value: 'light' },
    items: { type: Array, value: [] },
    wide: { type: Boolean, value: false },
  },

  data: {
    rows: [] as TrajectoryRow[],
    spans: [] as TimelineSpanView[],
    boundaries: [] as Array<{ turn: number; left: string }>,
    duration: false,
    timingAvailable: false,
    allTurnsCollapsed: false,
    callsCollapsed: false,
    collapsedTurns: [] as number[],
    search: '',
    searchActive: false,
    selectedIndex: -1,
    scrollTarget: '',
    detail: null as TrajectoryDetail | null,
    detailTab: 'overview' as DetailTab['id'],
    detailOpen: false,
    closeTimer: 0 as ReturnType<typeof setTimeout> | 0,
    empty: true,
    noResults: false,
    total: 0,
  },

  observers: {
    items() {
      this.refresh()
    },
  },

  lifetimes: {
    attached() {
      this.refresh()
    },
    detached() {
      const timer = this.data.closeTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },

  methods: {
    refresh() {
      const turns = buildTrajectoryTurns(this.data.items as ChatItem[])
      const cells = flattenCells(turns)
      const search = this.data.search
      const searchActive = search.trim().length > 0
      const collapsedTurns = this.data.collapsedTurns as number[]
      const selectedIndex = this.data.selectedIndex as number
      const selectedTurn = cells.find((cell) => cell.index === selectedIndex)?.turn
      const callsCollapsed = this.data.callsCollapsed as boolean
      const timingAvailable = cells.some((cell) => cell.startedAt !== null && (cell.timeSeconds ?? 0) > 0)

      const requestNumbers = new Map<string, number>()
      let requestNumber = 0
      for (const turn of turns) {
        for (const group of turn.groups) {
          if (group.title.startsWith('第 ')) {
            requestNumber += 1
            requestNumbers.set(group.key, requestNumber)
          }
        }
      }

      const collapsibleTurns = turns
        .filter((turn) => turn.cells.filter((cell) => cell.kind !== 'system').length > 1)
        .map((turn) => turn.turn)
      const allTurnsCollapsed = collapsibleTurns.length > 0
        && collapsibleTurns.every((turn) => collapsedTurns.includes(turn))

      const rows: TrajectoryRow[] = []
      for (const turn of turns) {
        const collapsible = turn.cells.filter((cell) => cell.kind !== 'system').length > 1
        const turnCollapsed = !searchActive && collapsible && collapsedTurns.includes(turn.turn)
        if (turnCollapsed) {
          const content = turn.cells.filter((cell) => cell.kind !== 'system')
          const first = content[0]
          if (first !== undefined) {
            rows.push(turnHeaderRow(turn.turn))
            rows.push(rowFromCell(first, {
              turnStart: true,
              showRequest: requestNumbers.has(first.groupKey),
              requestLabel: requestLabel(first, requestNumbers),
              selected: selectedIndex === first.index,
              turnActive: selectedTurn === turn.turn,
            }))
          }
          rows.push(summaryRow(
            `turn-summary-${turn.turn}`,
            'collapsed-turn',
            turn.turn,
            summarizeTurnCells(content.slice(1)),
            false,
            selectedTurn === turn.turn,
          ))
          continue
        }

        let turnStart = !searchActive || searchFiltersTurnIn(turn, search)
        const turnRowStart = rows.length
        for (const group of turn.groups) {
          const toolCells: TrajectoryCell[] = []
          let groupStart = true
          for (const cell of group.cells) {
            if (searchActive && !searchCell(cell, search)) continue
            if (!searchActive && callsCollapsed && cell.kind === 'tool' && group.title.startsWith('第 ')) {
              toolCells.push(cell)
              continue
            }
            rows.push(rowFromCell(cell, {
              turnStart,
              showRequest: groupStart && requestNumbers.has(group.key),
              requestLabel: requestLabel(cell, requestNumbers),
              selected: selectedIndex === cell.index,
              turnActive: selectedTurn === turn.turn,
            }))
            turnStart = false
            groupStart = false
          }
          if (toolCells.length > 0) {
            rows.push(summaryRow(
              `call-summary-${rows.length}`,
              'collapsed-call',
              turn.turn,
              summarizeCallCells(toolCells),
              false,
              selectedTurn === turn.turn,
            ))
            turnStart = false
          }
        }
        if (rows.length > turnRowStart) rows.splice(turnRowStart, 0, turnHeaderRow(turn.turn))
      }

      const model = buildTrajectoryTimeline(turns, this.data.duration ? 'duration' : 'sequence')
      const total = model === null ? 1 : Math.max(1, model.end - model.start)
      const spans = (model?.spans ?? []).map((span): TimelineSpanView => {
        const left = ((span.start - (model?.start ?? 0)) / total) * 100
        const width = ((span.end - span.start) / total) * 100
        return {
          index: span.index,
          kind: span.kind,
          left: `${left}%`,
          width: `calc(${width}% - 1px)`,
          lane: span.lane,
          selected: selectedIndex === span.index,
          dimmed: searchActive && cells.some((cell) => cell.index === span.index
            && !searchCell(cell, search)),
          isError: span.isError,
        }
      })
      const boundaries = (model?.turnBoundaries ?? []).map((boundary) => ({
        turn: boundary.turn,
        left: `${((boundary.time - (model?.start ?? 0)) / total) * 100}%`,
      }))

      this.setData({
        rows,
        spans,
        boundaries,
        timingAvailable,
        allTurnsCollapsed,
        searchActive,
        empty: cells.length === 0,
        noResults: searchActive && rows.length === 0,
        total: cells.length,
      })
    },

    toggleDuration() {
      this.setData({ duration: !this.data.duration }, () => this.refresh())
    },

    toggleAllTurns() {
      const turns = buildTrajectoryTurns(this.data.items as ChatItem[])
      const collapsible = turns
        .filter((turn) => turn.cells.filter((cell) => cell.kind !== 'system').length > 1)
        .map((turn) => turn.turn)
      if (collapsible.length === 0) return
      const collapsed = this.data.collapsedTurns as number[]
      const all = collapsible.every((turn) => collapsed.includes(turn))
      this.setData({
        collapsedTurns: all ? [] : collapsible,
        selectedIndex: -1,
      }, () => this.refresh())
    },

    toggleAllCalls() {
      this.setData({
        callsCollapsed: !this.data.callsCollapsed,
        selectedIndex: -1,
      }, () => this.refresh())
    },

    onSearch(event: WechatMiniprogram.Input) {
      this.setData({ search: event.detail.value, selectedIndex: -1 }, () => this.refresh())
    },

    onRowTap(event: WechatMiniprogram.TouchEvent) {
      const type = String(event.currentTarget.dataset.type ?? 'cell') as RowType
      if (type === 'turn-header') return
      if (type === 'collapsed-turn') {
        const turn = Number(event.currentTarget.dataset.turn ?? 0)
        const collapsed = (this.data.collapsedTurns as number[]).filter((value) => value !== turn)
        this.setData({ collapsedTurns: collapsed }, () => this.refresh())
        return
      }
      if (type === 'collapsed-call') {
        this.setData({ callsCollapsed: false }, () => this.refresh())
        return
      }
      const index = Number(event.currentTarget.dataset.index ?? -1)
      if (index < 0) return
      this.openCell(index)
    },

    onTimelineTap(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index ?? -1)
      if (index < 0) return
      this.openCell(index)
    },

    focusSeq(seq: number) {
      if (!Number.isFinite(seq) || seq <= 0) return
      const turns = buildTrajectoryTurns(this.data.items as ChatItem[])
      const cell = flattenCells(turns).find((candidate) => candidate.sourceSeq === seq)
      if (cell === undefined) return
      this.openCell(cell.index)
    },

    openCell(index: number) {
      const turns = buildTrajectoryTurns(this.data.items as ChatItem[])
      const cell = flattenCells(turns).find((candidate) => candidate.index === index)
      if (cell === undefined) return
      const detail = buildDetail(cell)
      const timer = this.data.closeTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
      this.setData({
        selectedIndex: index,
        detail,
        detailTab: 'overview',
        detailOpen: true,
        scrollTarget: `traj-row-cell-${index}`,
        closeTimer: 0,
      }, () => this.refresh())
    },

    closeDetail() {
      if (!this.data.detailOpen) return
      this.setData({
        detail: null,
        detailOpen: false,
        selectedIndex: -1,
        closeTimer: 0,
      }, () => this.refresh())
    },

    onDetailTab(event: WechatMiniprogram.CustomEvent<{ id?: string }>) {
      const id = String(event.detail?.id ?? 'overview') as DetailTab['id']
      this.setData({ detailTab: id })
    },

    onDetailMask() {
      this.closeDetail()
    },
  },
})

function requestLabel(cell: TrajectoryCell, numbers: Map<string, number>): string {
  const number = numbers.get(cell.groupKey)
  return number === undefined ? '' : `请求 #${number}`
}

function searchFiltersTurnIn(turn: TrajectoryTurn, query: string): boolean {
  return turn.cells.some((cell) => searchCell(cell, query))
}

function buildDetail(cell: TrajectoryCell): TrajectoryDetail {
  const tabs: DetailTab[] = [{ id: 'overview', label: '概述' }]
  const markdown = cell.kind === 'user' || cell.kind === 'message' || cell.kind === 'compacted'
  const raw = cell.kind === 'user'
    ? cell.inputText ?? cell.text
    : [cell.thinkingText, cell.outputText].filter((part): part is string => part !== undefined && part.length > 0).join('\n\n')
  if (markdown) {
    tabs.push({ id: 'preview', label: '预览' }, { id: 'raw', label: '原始内容' })
  } else {
    if ((cell.inputText ?? '').length > 0) tabs.push({ id: 'input', label: cell.kind === 'tool' ? '参数' : '输入' })
    if ((cell.outputText ?? '').length > 0) tabs.push({ id: 'output', label: cell.kind === 'tool' ? '结果' : '输出' })
    if ((cell.thinkingText ?? '').length > 0) tabs.push({ id: 'thinking', label: '思考' })
  }
  tabs.push({ id: 'timing', label: '计时' })

  const location = cell.step > 0
    ? `第 ${cell.turn} 轮 · 第 ${cell.step} 步`
    : `第 ${cell.turn} 轮 · 消息`
  const overview: DetailRow[] = [
    { label: '状态', value: cell.statusLabel, error: cell.isError },
    { label: '类型', value: KIND_LABEL[cell.kind] },
    { label: '位置', value: location },
    { label: '来源序号', value: String(cell.sourceSeq) },
  ]
  if (cell.toolName !== undefined) overview.push({ label: '工具', value: cell.toolName })
  if (cell.resultText !== undefined && cell.resultText.length > 0) {
    overview.push({ label: '结果预览', value: cell.resultText, error: cell.isError })
  }
  const timing: DetailRow[] = [
    { label: '开始时间', value: formatClock(cell.startedAt) },
    { label: '耗时', value: formatElapsedSeconds(cell.timeSeconds) },
  ]
  return {
    index: cell.index,
    kind: cell.kind,
    kindLabel: KIND_LABEL[cell.kind],
    location,
    status: cell.statusLabel,
    isError: cell.isError,
    timeLabel: formatElapsedSeconds(cell.timeSeconds),
    tabs,
    overview,
    raw,
    previewText: markdown ? (cell.kind === 'user' ? cell.inputText ?? '' : cell.outputText ?? '') : '',
    input: cell.inputText ?? '',
    output: cell.outputText ?? cell.resultText ?? '',
    thinking: cell.thinkingText ?? '',
    timing,
  }
}
