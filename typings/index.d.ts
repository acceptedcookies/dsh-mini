interface IAppOption {
  globalData: {
    theme: 'light' | 'dark'
    sessionId?: string
    /** DevTools 调试面：__diagnostics(sid?)→bundle；__errorBus=总线实例。 */
    __diagnostics?: unknown
    __errorBus?: unknown
    /** DevTools 调试面：皮肤引擎单例（fixture 注入/T18 证据）。 */
    __skinEngine?: unknown
  }
}
