/** 轨迹账本的数据投影:把 ChatItem 折成 dsh 的 turn → step → cell 结构。 */

import type { ChatItem } from '../types/protocol'

export type TrajectoryKind =
  | 'system'
  | 'user'
  | 'context'
  | 'compacted'
  | 'message'
  | 'tool'
  | 'subtool'

export interface TrajectoryCell {
  index: number
  kind: TrajectoryKind
  kindLabel: string
  text: string
  resultText?: string
  inputText?: string
  outputText?: string
  thinkingText?: string
  toolName?: string
  callId?: string
  sourceId: string
  sourceSeq: number
  turn: number
  step: number
  groupKey: string
  startedAt: number | null
  timeSeconds: number | null
  isError: boolean
  running: boolean
  statusLabel: string
}

export interface TrajectoryGroup {
  key: string
  title: string
  description?: string
  cells: TrajectoryCell[]
}

export interface TrajectoryTurn {
  turn: number
  groups: TrajectoryGroup[]
  cells: TrajectoryCell[]
}

export interface TrajectorySpan {
  index: number
  kind: TrajectoryKind
  lane: number
  start: number
  end: number
  isError: boolean
}

export interface TrajectoryTimelineModel {
  start: number
  end: number
  spans: TrajectorySpan[]
  turnBoundaries: Array<{ turn: number; time: number }>
}

export const KIND_LABEL: Record<TrajectoryKind, string> = {
  system: '系统',
  user: '用户',
  context: '上下文',
  compacted: '已压缩',
  message: '消息',
  tool: '工具',
  subtool: '子工具',
}

/** 账本里工具行使用的斜体标签与表头保持一致。 */
export const TOOL_TAG_LABEL = '工具'

interface StepBucket {
  step: number
  key: string
  cells: TrajectoryCell[]
  hasMessage: boolean
}

interface TurnBucket {
  turn: number
  userCells: TrajectoryCell[]
  steps: StepBucket[]
  extra: TrajectoryCell[]
}

function preview(text: string, limit = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function cellStatus(item: ChatItem): { isError: boolean; running: boolean; label: string } {
  if (item.kind === 'tool_call') {
    return {
      isError: item.status === 'error',
      running: item.status === 'running',
      label: item.status === 'running' ? '运行中' : item.status === 'error' ? '失败' : '已完成',
    }
  }
  if (item.kind === 'tool_result') {
    return { isError: item.status === 'error', running: false, label: item.status === 'error' ? '失败' : '已完成' }
  }
  if (item.kind === 'notice' && item.level === 'error') {
    return { isError: true, running: false, label: '失败' }
  }
  return { isError: false, running: false, label: '已完成' }
}

function makeCell(
  item: ChatItem,
  index: number,
  turn: number,
  step: number,
  groupKey: string,
  kind: TrajectoryKind,
  text: string,
): TrajectoryCell {
  const status = cellStatus(item)
  const startedAt = item.ts ?? null
  return {
    index,
    kind,
    kindLabel: KIND_LABEL[kind],
    text,
    sourceId: item.id,
    sourceSeq: item.seq,
    turn,
    step,
    groupKey,
    startedAt,
    timeSeconds: null,
    isError: status.isError,
    running: status.running,
    statusLabel: status.label,
  }
}

function toolText(item: Extract<ChatItem, { kind: 'tool_call' }>): string {
  const raw = item.args ?? ''
  const args = raw.length === 0 ? '' : preview(raw, 120)
  return args.length === 0 || args === '{}' ? item.tool : `${item.tool} · ${args}`
}

function groupSpanDescription(cells: TrajectoryCell[]): string | undefined {
  const starts = cells.map((cell) => cell.startedAt).filter((value): value is number => value !== null)
  const ends = cells.flatMap((cell) => {
    if (cell.startedAt === null || cell.timeSeconds === null) return []
    return [cell.startedAt + cell.timeSeconds * 1000]
  })
  const parts: string[] = []
  if (starts.length > 0 && ends.length > 0) {
    const span = (Math.max(...ends) - Math.min(...starts)) / 1000
    if (Number.isFinite(span) && span > 0) parts.push(formatElapsedSeconds(span))
  }
  const counts = new Map<string, number>()
  for (const cell of cells) {
    if (cell.toolName === undefined) continue
    counts.set(cell.toolName, (counts.get(cell.toolName) ?? 0) + 1)
  }
  for (const [name, count] of counts) parts.push(count > 1 ? `${name}×${count}` : name)
  return parts.length === 0 ? undefined : parts.join(' ')
}

/**
 * 把会话条目折成 dsh 轨迹的 turn/step/cell 三层。
 * 用户消息开启新一轮;assistant 消息结束一步;工具结果合并回对应的工具行。
 */
export function buildTrajectoryTurns(items: ChatItem[]): TrajectoryTurn[] {
  const sorted = [...items].sort((left, right) => left.seq - right.seq)
  const buckets = new Map<number, TurnBucket>()
  let turn = 1
  let current: TurnBucket = { turn, userCells: [], steps: [], extra: [] }
  buckets.set(turn, current)
  let index = 0
  const unmatchedTools: TrajectoryCell[] = []

  const bucketOf = (target: number): TurnBucket => {
    const existing = buckets.get(target)
    if (existing !== undefined) return existing
    const created: TurnBucket = { turn: target, userCells: [], steps: [], extra: [] }
    buckets.set(target, created)
    return created
  }

  const currentStep = (bucket: TurnBucket, startNew = false): StepBucket => {
    const last = bucket.steps[bucket.steps.length - 1]
    if (!startNew && last !== undefined && !last.hasMessage) return last
    const step = bucket.steps.length + 1
    const created: StepBucket = {
      step,
      key: `turn:${bucket.turn}:step:${step}`,
      cells: [],
      hasMessage: false,
    }
    bucket.steps.push(created)
    return created
  }

  for (const item of sorted) {
    if (item.kind === 'user_message') {
      if (current.userCells.length > 0 || current.steps.length > 0 || current.extra.length > 0) {
        turn += 1
        current = bucketOf(turn)
      }
      const cell = makeCell(item, ++index, turn, 0, `turn:${turn}:message`, 'user', preview(item.text))
      cell.kindLabel = KIND_LABEL.user
      cell.inputText = item.text
      current.userCells.push(cell)
      continue
    }

    if (item.kind === 'assistant_message') {
      const step = currentStep(current)
      const raw = item.text.trim().length > 0 ? item.text : item.thinking ?? ''
      const cell = makeCell(item, ++index, turn, step.step, step.key, 'message', raw.trim().length === 0 ? '仅工具调用' : preview(raw))
      cell.outputText = item.text
      cell.thinkingText = item.thinking
      cell.inputText = undefined
      const previous = step.cells[step.cells.length - 1]
      if (previous?.startedAt !== undefined && previous.startedAt !== null && cell.startedAt !== null) {
        cell.timeSeconds = Math.max(0, (cell.startedAt - previous.startedAt) / 1000)
      }
      step.cells.push(cell)
      step.hasMessage = true
      continue
    }

    if (item.kind === 'tool_call') {
      const step = currentStep(current)
      const cell = makeCell(item, ++index, turn, step.step, step.key, 'tool', toolText(item))
      cell.toolName = item.tool
      cell.callId = item.callId
      cell.inputText = item.args ?? item.detail
      cell.statusLabel = item.status === 'running' ? '运行中' : item.status === 'error' ? '失败' : '已完成'
      step.cells.push(cell)
      unmatchedTools.push(cell)
      continue
    }

    if (item.kind === 'tool_result') {
      let matched: TrajectoryCell | undefined
      for (let i = unmatchedTools.length - 1; i >= 0; i -= 1) {
        const candidate = unmatchedTools[i]
        if (candidate === undefined) continue
        if (candidate.turn === turn && candidate.toolName === item.tool) {
          matched = candidate
          unmatchedTools.splice(i, 1)
          break
        }
      }
      if (matched !== undefined) {
        matched.resultText = item.summary
        matched.outputText = item.detail ?? item.summary
        matched.isError = item.status === 'error'
        matched.running = false
        matched.statusLabel = item.status === 'error' ? '失败' : '已完成'
        if (matched.startedAt !== null && item.ts !== undefined) {
          matched.timeSeconds = Math.max(0, (item.ts - matched.startedAt) / 1000)
        }
        continue
      }
      const step = currentStep(current)
      const cell = makeCell(item, ++index, turn, step.step, step.key, 'tool', `${item.tool} · ${preview(item.summary, 80)}`)
      cell.toolName = item.tool
      cell.resultText = item.summary
      cell.outputText = item.detail ?? item.summary
      step.cells.push(cell)
      continue
    }

    if (item.kind === 'diff') {
      const step = currentStep(current)
      const cell = makeCell(item, ++index, turn, step.step, step.key, 'context', `${item.path} · ${preview(item.summary)}`)
      cell.inputText = item.text
      step.cells.push(cell)
      continue
    }

    if (item.kind === 'notice') {
      if (current.steps.length === 0 && current.userCells.length === 0) {
        const cell = makeCell(item, ++index, turn, 0, `turn:${turn}:message`, 'system', preview(item.text))
        current.extra.push(cell)
      } else {
        const step = currentStep(current)
        const cell = makeCell(item, ++index, turn, step.step, step.key, 'system', preview(item.text))
        step.cells.push(cell)
      }
    }
  }

  const turns: TrajectoryTurn[] = []
  for (const bucket of buckets.values()) {
    const groups: TrajectoryGroup[] = []
    if (bucket.userCells.length > 0 || bucket.extra.length > 0) {
      const cells = [...bucket.userCells, ...bucket.extra]
      groups.push({ key: `turn:${bucket.turn}:message`, title: '消息', cells })
    }
    for (const step of bucket.steps) {
      // dsh 的 step 组总是先给 assistant 消息,再列工具调用。
      const messages = step.cells.filter((cell) => cell.kind === 'message')
      const tools = step.cells.filter((cell) => cell.kind === 'tool' || cell.kind === 'subtool')
      const others = step.cells.filter((cell) => cell.kind !== 'message' && cell.kind !== 'tool' && cell.kind !== 'subtool')
      const cells = [...messages, ...tools, ...others]
      if (cells.length === 0) continue
      groups.push({
        key: step.key,
        title: `第 ${step.step} 步`,
        description: groupSpanDescription(cells),
        cells,
      })
    }
    if (groups.length === 0) continue
    turns.push({ turn: bucket.turn, groups, cells: groups.flatMap((group) => group.cells) })
  }
  return turns
}

export function flattenCells(turns: TrajectoryTurn[]): TrajectoryCell[] {
  return turns.flatMap((turn) => turn.cells)
}

export function formatDurationMs(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—'
  const integer = String(Math.round(milliseconds)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${integer} 毫秒`
}

export function formatElapsedSeconds(seconds: number | null): string {
  return formatDurationMs(seconds === null ? null : seconds * 1000)
}

export function formatClock(timestamp: number | null): string {
  if (timestamp === null) return '—'
  const date = new Date(timestamp)
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export function searchCell(cell: TrajectoryCell, query: string): boolean {
  const keyword = query.trim().toLowerCase()
  if (keyword.length === 0) return true
  return [cell.text, cell.kindLabel, cell.toolName, cell.resultText, cell.inputText, cell.outputText, cell.thinkingText]
    .some((value) => value !== undefined && value.toLowerCase().includes(keyword))
}

/**
 * 把账本记录投影到三泳道时间线。sequence 模式等宽;duration 模式按记录时长。
 * 无计时数据时回退到等宽,避免出现全零宽度。
 */
export function buildTrajectoryTimeline(
  turns: TrajectoryTurn[],
  mode: 'sequence' | 'duration',
): TrajectoryTimelineModel | null {
  const cells = flattenCells(turns)
  if (cells.length === 0) return null
  const timed = mode === 'duration'
    && cells.some((cell) => cell.startedAt !== null && (cell.timeSeconds ?? 0) > 0)
  if (!timed) {
    const spans: TrajectorySpan[] = []
    const turnBoundaries: Array<{ turn: number; time: number }> = []
    for (const turn of turns) {
      if (turn.cells.length === 0) continue
      turnBoundaries.push({ turn: turn.turn, time: spans.length })
      for (const cell of turn.cells) {
        spans.push({
          index: cell.index,
          kind: cell.kind,
          lane: laneFor(cell.kind),
          start: spans.length,
          end: spans.length + 1,
          isError: cell.isError,
        })
      }
    }
    return { start: 0, end: spans.length, spans, turnBoundaries }
  }
  const raw: Array<TrajectorySpan & { absStart: number; absEnd: number }> = cells.flatMap((cell) => {
    if (cell.startedAt === null) return []
    const duration = (cell.timeSeconds ?? 0) * 1000
    return [{
      index: cell.index,
      kind: cell.kind,
      lane: laneFor(cell.kind),
      start: 0,
      end: 0,
      isError: cell.isError,
      absStart: cell.startedAt,
      absEnd: cell.startedAt + duration,
    }]
  })
  if (raw.length === 0) return null
  const start = Math.min(...raw.map((span) => span.absStart))
  const end = Math.max(...raw.map((span) => span.absEnd))
  const duration = Math.max(1, end - start)
  const spans: TrajectorySpan[] = raw.map((span) => ({
    index: span.index,
    kind: span.kind,
    lane: span.lane,
    start: span.absStart - start,
    end: Math.max(span.absStart + 1, span.absEnd) - start,
    isError: span.isError,
  }))
  const turnBoundaries = turns.flatMap((turn) => {
    const first = turn.cells.find((cell) => cell.startedAt !== null)
    return first?.startedAt === undefined || first.startedAt === null
      ? []
      : [{ turn: turn.turn, time: first.startedAt - start }]
  })
  return { start: 0, end: duration, spans, turnBoundaries }
}

function laneFor(kind: TrajectoryKind): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'message' || kind === 'compacted') return 1
  return 0
}

export function summarizeTurnCells(cells: TrajectoryCell[]): string {
  const steps = new Set(cells.filter((cell) => cell.kind !== 'user' && cell.kind !== 'system').map((cell) => cell.groupKey)).size
  const toolCalls = cells.filter((cell) => cell.kind === 'tool' || cell.kind === 'subtool').length
  return `${steps} 个步骤 · ${toolCalls} 个工具调用`
}

export function summarizeCallCells(cells: TrajectoryCell[]): string {
  const names = [...new Set(cells.map((cell) => cell.toolName ?? cell.text.split(' · ')[0]).filter((name) => name.length > 0))]
  const count = cells.length
  return names.length === 0 ? `${count} 个工具调用` : `${count} 个工具调用 · ${names.join(', ')}`
}
