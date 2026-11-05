interface IAppOption {
  globalData: {
    theme: 'light' | 'dark'
    sessionId?: string
    /** VFS 测试钩子（automator evaluate 入口）。 */
    __vfs?: unknown
    __vfsRemoteFor?: unknown
    __vfsSyncFor?: unknown
    __ioStateFor?: unknown
    /** durable 铸票面测试钩子（E10 语义直达——IDE 探针用）。 */
    __hasFreshTicket?: unknown
    __ensureDurableTicket?: unknown
    /** MN03 诊断/错误钩子：__diagnostics(sid?)→bundle；__errorBus=总线实例。 */
    __diagnostics?: unknown
    __errorBus?: unknown
    /** MN03-B9 agentic 真轮探针钩：__sessionStore=sessionStore 单例。 */
    __sessionStore?: unknown
  }
}
