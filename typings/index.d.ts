interface IAppOption {
  globalData: {
    theme: 'light' | 'dark'
    sessionId?: string
    /** DevTools 调试面：__diagnostics(sid?)→bundle；__errorBus=总线实例。 */
    __diagnostics?: unknown
    __errorBus?: unknown
  }
}
