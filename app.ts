// app.ts
import { getTheme, watchSystemTheme } from './services/theme'
import { errorBus, reportSilent } from './services/error-report'
import { sessionDiagnostics } from './services/diagnostics'
import { vfs, vfsReadView, vfsStore } from './services/vfs/api'
import { setVfsMirrorHook } from './services/vfs/vfs'
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from './services/nano-mini-host/tick'
import { vfsRemoteFor, vfsSyncFor, ioStateFor, ensureDurableTicket } from './services/state/provider'
import { hasFreshTicket, onTicketMinted } from './services/fx/ticket'

/** cloud 车道 VFS 远端镜像接线（MN02 G1 durable lane 活线）：
 *  写/删 → fire-and-forget 推送（失败 warn 不阻塞本地写——reconcile 兜底自愈）；
 *  reconcile：远端清单/行下拉（updated_ms 大者赢）→ 本地行推送（指针增量）。 */
function wireRemoteMirror(): void {
  let inFlight: Promise<void> | undefined
  const doReconcile = async (): Promise<void> => {
    // 句柄每次重解析——remote-durable 开关/配置翻转即时生效，不吃启动时陈旧快照（审查三轮）。
    const s = vfsSyncFor()
    if (s === null) return
    try {
      await s.pullWorkspaces()
      const pulled = await s.pullRows()
      for (const p of pulled) await s.hydrate(p)
      // 行在字节失（cache 清理）不只在 pulled 集内——全量缺失面自愈（审查三轮 N4）。
      await s.hydrateMissing()
      const rep = await s.pushAll()
      if (rep.failed.length > 0) console.warn('[vfs-mirror] reconcile 残留失败:', rep.failed)
    } catch (e) {
      console.warn('[vfs-mirror] reconcile 失败（远端不可达——写路径仍先推）:', e instanceof Error ? e.message : e)
      // 后台 reconcile 是 best-effort 兜底——silent 台账不弹（MN03-R1）。
      reportSilent(e, { op: 'vfs-mirror', lane: 'background' })
    }
  }
  // 后台面铁律：无活票据不碰远端——铸票=SOTER 须用户手势上下文（审查 B8）。
  // 票据铸成（onTicketMinted）即 reconcile 兜底全部跳过/失败的上行；in-flight 单飞防重入。
  const reconcile = (): void => {
    if (!hasFreshTicket() || inFlight !== undefined) return
    inFlight = doReconcile().finally(() => { inFlight = undefined })
  }
  setVfsMirrorHook((path, kind) => {
    if (!hasFreshTicket()) return
    const s = vfsSyncFor()
    if (s === null) return
    const p = kind === 'write' ? s.pushPath(path) : s.pushRemove(path)
    p.then(() => reconcile()).catch((e) => {
      console.warn(`[vfs-mirror] ${kind} ${path} 推送失败（reconcile 兜底）:`, e instanceof Error ? e.message : e)
      // 高频面——每次写都可能撞远端不可达，仅入 silent 台账不弹（reconcile 兜底）。
      reportSilent(e, { op: 'vfs-push', lane: 'background', path })
    })
  })
  onTicketMinted(() => reconcile())
  reconcile()
}

App<IAppOption>({
  globalData: {
    theme: getTheme(),
    /** VFS 测试钩子：automator evaluate 经 getApp().globalData.__vfs 直达。 */
    __vfs: { vfs, vfsReadView, vfsStore } as unknown,
    /** durable 远端钩子：cloud 路由下返回 RemoteVfs/VfsSync 实例，否则 null。 */
    __vfsRemoteFor: vfsRemoteFor as unknown,
    __vfsSyncFor: vfsSyncFor as unknown,
    __ioStateFor: ioStateFor as unknown,
    /** durable 铸票面测试钩子：authHeaders 缓存只读后，远端句柄 401 时须
     *  显式铸票（SOTER=真机面，DevTools 可模拟 TouchID）——E10 语义直达。 */
    __hasFreshTicket: hasFreshTicket as unknown,
    __ensureDurableTicket: ensureDurableTicket as unknown,
    /** MN03 G2：session 诊断 bundle——devtools MCP/automator evaluate 直达
     *  （`getApp().globalData.__diagnostics(sid?)`，sid 缺席=当前会话）。 */
    __diagnostics: sessionDiagnostics as unknown,
    __errorBus: errorBus as unknown,
  },
  onLaunch() {
    watchSystemTheme((theme) => {
      this.globalData.theme = theme
    })
    // 纯资源分包下载由 app.json preloadRule（workspace 页）触发；
    // 消费端各自轮询等待（loadKernelAsync / instantiate 重试），launch 无需预热调用
    // T-O-9：启动 catch-up（sweep due 闹钟/恢复挂起 turn）——catch 住防 unhandled rejection
    nanoMiniCatchUp().catch((e) => {
      console.warn('[nano-mini] catchUp failed:', e)
      reportSilent(e, { op: 'catch-up', lane: 'background' })
    })
    wireRemoteMirror()
  },
  onShow() {
    // T-O-9：前台 30s tick
    nanoMiniStartTick()
  },
  onHide() {
    // T-O-9：停 interval + 落 pending-catchup 标记
    nanoMiniStopTick()
  },
})
 