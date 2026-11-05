import { errorBus } from './error-report'

const THEME_KEY = 'dsh:theme:v2'
const LAST_SESSION_KEY = 'dsh:last-session:v2'
const SESSIONS_KEY = 'dsh:sessions:v2'
const MODEL_KEY = 'dsh:model:v2'
const ENROLLMENT_KEY = 'dsh:byok-enrollment:v1'
const PERMISSION_KEY = 'dsh:permission:v1'
const PLAN_KEY = 'dsh:plan-mode:v1'
const GOAL_KEY = 'dsh:goal:v1'
const FEEDBACK_KEY = 'dsh:feedback:v1'
const FEEDBACK_RATINGS_KEY = 'dsh:feedback-ratings:v1'

/** wx.getStorageSync returns '' for a missing key; callers need absence. */
function readStorage<T>(key: string): T | undefined {
  const value = wx.getStorageSync(key) as T | '' | undefined
  return value === '' || value === undefined ? undefined : value
}

/** 写失败经 errorBus 标准化（quota→storage-quota modal）后吞错——caller 继续
 *  优雅降级而非未捕获异常；用户经错误面被告知存储满而非静默丢写（MN03-R1）。 */
function writeSafe(key: string, value: unknown, op: string): void {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    errorBus.report(e, { op: `storage.${op}`, lane: 'ui' })
  }
}

export const storage = {
  getTheme(): 'light' | 'dark' | undefined {
    const value = readStorage<'light' | 'dark'>(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : undefined
  },
  setTheme(value: 'light' | 'dark'): void {
    writeSafe(THEME_KEY, value, 'setTheme')
  },
  clearTheme(): void {
    wx.removeStorageSync(THEME_KEY)
  },
  getLastSessionId(): string | undefined {
    return readStorage<string>(LAST_SESSION_KEY)
  },
  setLastSessionId(value: string): void {
    writeSafe(LAST_SESSION_KEY, value, 'setLastSessionId')
  },
  clearLastSessionId(): void {
    wx.removeStorageSync(LAST_SESSION_KEY)
  },
  getSessions<T>(): T[] | undefined {
    const value = readStorage<T[]>(SESSIONS_KEY)
    return Array.isArray(value) ? value : undefined
  },
  setSessions<T>(value: T[]): void {
    writeSafe(SESSIONS_KEY, value, 'setSessions')
  },
  getModel(): string | undefined {
    return readStorage<string>(MODEL_KEY)
  },
  setModel(value: string): void {
    writeSafe(MODEL_KEY, value, 'setModel')
  },
  getPermission(): string | undefined {
    return readStorage<string>(PERMISSION_KEY)
  },
  setPermission(value: string): void {
    writeSafe(PERMISSION_KEY, value, 'setPermission')
  },
  getPlanMode(): boolean | undefined {
    return readStorage<boolean>(PLAN_KEY)
  },
  setPlanMode(value: boolean): void {
    writeSafe(PLAN_KEY, value, 'setPlanMode')
  },
  getGoal(): string | undefined {
    return readStorage<string>(GOAL_KEY)
  },
  getFeedbackRatings(): Record<string, string> {
    return readStorage<Record<string, string>>(FEEDBACK_RATINGS_KEY) ?? {}
  },
  setFeedbackRating(messageId: string, rating: string): void {
    if (messageId.length === 0) return
    const ratings = this.getFeedbackRatings()
    if (rating.length === 0) delete ratings[messageId]
    else ratings[messageId] = rating
    writeSafe(FEEDBACK_RATINGS_KEY, ratings, 'setFeedbackRating')
  },
  addFeedback(text: string, meta: { rating?: string; category?: string; messageId?: string } = {}): void {
    const list = readStorage<Array<{ text: string; at: number; rating?: string; category?: string; messageId?: string }>>(FEEDBACK_KEY) ?? []
    const next = [...list, { text, at: Date.now(), ...meta }].slice(-20)
    writeSafe(FEEDBACK_KEY, next, 'addFeedback')
  },
  setGoal(value: string): void {
    if (value.length === 0) wx.removeStorageSync(GOAL_KEY)
    else writeSafe(GOAL_KEY, value, 'setGoal')
  },
  /** BYOK 注入记录（非密：provider/base_url/model/时间，绝不含 api_key）。 */
  getEnrollment<T>(): T | undefined {
    return readStorage<T>(ENROLLMENT_KEY)
  },
  setEnrollment<T>(value: T): void {
    writeSafe(ENROLLMENT_KEY, value, 'setEnrollment')
  },
  clearEnrollment(): void {
    wx.removeStorageSync(ENROLLMENT_KEY)
  },
  clearConversations(): void {
    wx.removeStorageSync(SESSIONS_KEY)
    wx.removeStorageSync(LAST_SESSION_KEY)
  },
  clearAll(): void {
    wx.removeStorageSync(THEME_KEY)
    wx.removeStorageSync(LAST_SESSION_KEY)
    wx.removeStorageSync(SESSIONS_KEY)
    wx.removeStorageSync(MODEL_KEY)
    wx.removeStorageSync(ENROLLMENT_KEY)
    wx.removeStorageSync(PERMISSION_KEY)
    wx.removeStorageSync(PLAN_KEY)
    wx.removeStorageSync(GOAL_KEY)
    wx.removeStorageSync(FEEDBACK_KEY)
    wx.removeStorageSync(FEEDBACK_RATINGS_KEY)
  },
}
