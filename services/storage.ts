const THEME_KEY = 'dsh:theme:v2'
const LAST_SESSION_KEY = 'dsh:last-session:v2'
const SESSIONS_KEY = 'dsh:sessions:v2'
const MODEL_KEY = 'dsh:model:v2'
const ENROLLMENT_KEY = 'dsh:byok-enrollment:v1'
const PERMISSION_KEY = 'dsh:permission:v1'
const PLAN_KEY = 'dsh:plan-mode:v1'
const GOAL_KEY = 'dsh:goal:v1'
const FEEDBACK_KEY = 'dsh:feedback:v1'

/** wx.getStorageSync returns '' for a missing key; callers need absence. */
function readStorage<T>(key: string): T | undefined {
  const value = wx.getStorageSync(key) as T | '' | undefined
  return value === '' || value === undefined ? undefined : value
}

export const storage = {
  getTheme(): 'light' | 'dark' | undefined {
    const value = readStorage<'light' | 'dark'>(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : undefined
  },
  setTheme(value: 'light' | 'dark'): void {
    wx.setStorageSync(THEME_KEY, value)
  },
  clearTheme(): void {
    wx.removeStorageSync(THEME_KEY)
  },
  getLastSessionId(): string | undefined {
    return readStorage<string>(LAST_SESSION_KEY)
  },
  setLastSessionId(value: string): void {
    wx.setStorageSync(LAST_SESSION_KEY, value)
  },
  clearLastSessionId(): void {
    wx.removeStorageSync(LAST_SESSION_KEY)
  },
  getSessions<T>(): T[] | undefined {
    const value = readStorage<T[]>(SESSIONS_KEY)
    return Array.isArray(value) ? value : undefined
  },
  setSessions<T>(value: T[]): void {
    wx.setStorageSync(SESSIONS_KEY, value)
  },
  getModel(): string | undefined {
    return readStorage<string>(MODEL_KEY)
  },
  setModel(value: string): void {
    wx.setStorageSync(MODEL_KEY, value)
  },
  getPermission(): string | undefined {
    return readStorage<string>(PERMISSION_KEY)
  },
  setPermission(value: string): void {
    wx.setStorageSync(PERMISSION_KEY, value)
  },
  getPlanMode(): boolean | undefined {
    return readStorage<boolean>(PLAN_KEY)
  },
  setPlanMode(value: boolean): void {
    wx.setStorageSync(PLAN_KEY, value)
  },
  getGoal(): string | undefined {
    return readStorage<string>(GOAL_KEY)
  },
  addFeedback(text: string): void {
    const list = readStorage<Array<{ text: string; at: number }>>(FEEDBACK_KEY) ?? []
    const next = [...list, { text, at: Date.now() }].slice(-20)
    wx.setStorageSync(FEEDBACK_KEY, next)
  },
  setGoal(value: string): void {
    if (value.length === 0) wx.removeStorageSync(GOAL_KEY)
    else wx.setStorageSync(GOAL_KEY, value)
  },
  /** BYOK 注入记录（非密：provider/base_url/model/时间，绝不含 api_key）。 */
  getEnrollment<T>(): T | undefined {
    return readStorage<T>(ENROLLMENT_KEY)
  },
  setEnrollment<T>(value: T): void {
    wx.setStorageSync(ENROLLMENT_KEY, value)
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
  },
}
