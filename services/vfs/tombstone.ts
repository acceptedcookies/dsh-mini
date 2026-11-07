/**
 * tombstone —— 删除意图唯一持久 store（EP-1 T-O-7）。
 *
 * 值类型：旧版 `number`（deleted_ms，按 committed 读）或
 * `{ at_ms, phase: 'pending' | 'committed' }`。
 * `beginDelete` 在 `removeRow` 前落 pending；`commitDelete` 标 committed；
 * `abortDelete` 只在 pending 时清除（绝不回滚已提交删除）。
 *
 * 只依赖 wx.storage；不 import remote-sync / remote，避免核心 VFS 耦合同步层。
 * 512 上限按 at_ms 淘汰最旧；旧数字值懒归一，不批量迁移。
 */

export type TombPhase = 'pending' | 'committed'
export type TombValue = number | { at_ms: number; phase: TombPhase }

export const TOMB_KEY = 'dsh:mini:vfs-tombstones'
export const TOMB_CAP = 512

function readTombs(): Record<string, TombValue> {
  const v = wx.getStorageSync(TOMB_KEY) as Record<string, TombValue> | '' | undefined
  if (v === '' || v === undefined || v === null || typeof v !== 'object') return {}
  // 浅拷贝：setStorageSync 失败时不得让内存引用提前“提交”未落盘的 phase。
  return { ...v }
}

/** 归一旧数字值；损坏值按 0（最旧）处理。 */
export function atMs(v: TombValue | undefined): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v !== null && typeof v === 'object' && typeof v.at_ms === 'number' && Number.isFinite(v.at_ms)) return v.at_ms
  return 0
}

/** 旧数字值按 committed 读；缺 phase 的对象也按 committed。 */
export function phaseOf(v: TombValue | undefined): TombPhase {
  if (v !== null && typeof v === 'object' && v.phase === 'pending') return 'pending'
  return 'committed'
}

function cap(map: Record<string, TombValue>): void {
  const keys = Object.keys(map)
  if (keys.length <= TOMB_CAP) return
  keys.sort((a, b) => atMs(map[a]) - atMs(map[b]))
  for (const k of keys.slice(0, keys.length - TOMB_CAP)) delete map[k]
}

function writeTombs(map: Record<string, TombValue>): void {
  cap(map)
  wx.setStorageSync(TOMB_KEY, map)
}

/** 已提交删除意图（写法兼容旧数字值）。 */
export function setTomb(path: string): void {
  const t = readTombs()
  t[path] = { at_ms: Date.now(), phase: 'committed' }
  writeTombs(t)
}

/** 删除意图前置：row 删除前同步落 pending；storage 失败向上抛，调用方必须中止 remove。 */
export function beginDelete(path: string): void {
  const t = readTombs()
  t[path] = { at_ms: Date.now(), phase: 'pending' }
  writeTombs(t)
}

/** 本地 row 已删——标 committed（保留 at_ms，供 pullRows LWW 比较）。 */
export function commitDelete(path: string): void {
  const t = readTombs()
  const cur = t[path]
  t[path] = { at_ms: cur === undefined ? Date.now() : atMs(cur), phase: 'committed' }
  writeTombs(t)
}

/** 只清 pending；已提交删除不得被 abort 回滚。 */
export function abortDelete(path: string): void {
  const t = readTombs()
  if (t[path] !== undefined && phaseOf(t[path]) === 'pending') {
    delete t[path]
    writeTombs(t)
  }
}

export function clearTomb(path: string): void {
  const t = readTombs()
  if (t[path] !== undefined) {
    delete t[path]
    writeTombs(t)
  }
}

export function allTombstones(): Record<string, TombValue> {
  return readTombs()
}

export function pendingCount(): number {
  return Object.values(readTombs()).filter((v) => phaseOf(v) === 'pending').length
}

export function committedCount(): number {
  return Object.values(readTombs()).filter((v) => phaseOf(v) === 'committed').length
}
