interface IAppOption {
  globalData: {
    theme: 'light' | 'dark'
    sessionId?: string
    /** VFS 测试钩子（automator evaluate 入口）。 */
    __vfs?: unknown
  }
}
