// app.ts
import { getTheme, watchSystemTheme } from './services/theme'
import { vfs, vfsReadView, vfsStore } from './services/vfs/api'
import { setVfsMirrorHook } from './services/vfs/vfs'
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from './services/nano-mini-host/tick'
import { vfsRemoteFor, vfsSyncFor, ioStateFor } from './services/state/provider'
import { hasFreshTicket, onTicketMinted } from './services/fx/ticket'

/** cloud 车道 VFS 远端镜像接线（MN02 G1 durable lane 活线）：
 *  写/删 → fire-and-forget 推送（失败 warn 不阻塞本地写——reconcile 兜底自愈）；
 *  reconcile：远端清单/行下拉（updated_ms 大者赢）→ 本地行推送（指针增量）。 */
function wireRemoteMirror(): void {
  const sync = vfsSyncFor()
  if (sync === null) return
  let inFlight: Promise<void> | undefined
  const doReconcile = async (): Promise<void> => {
    try {
      await sync.pullWorkspaces()
      const pulled = await sync.pullRows()
      for (const p of pulled) await sync.hydrate(p)
      const rep = await sync.pushAll()
      if (rep.failed.length > 0) console.warn('[vfs-mirror] reconcile 残留失败:', rep.failed)
    } catch (e) {
      console.warn('[vfs-mirror] reconcile 失败（远端不可达——写路径仍先推）:', e instanceof Error ? e.message : e)
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
    const p = kind === 'write' ? sync.pushPath(path) : sync.pushRemove(path)
    p.then(() => reconcile()).catch((e) => console.warn(`[vfs-mirror] ${kind} ${path} 推送失败（reconcile 兜底）:`, e instanceof Error ? e.message : e))
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
  },
  onLaunch() {
    watchSystemTheme((theme) => {
      this.globalData.theme = theme
    })
    // 纯资源分包下载由 app.json preloadRule（workspace 页）触发；
    // 消费端各自轮询等待（loadKernelAsync / instantiate 重试），launch 无需预热调用
    // T-O-9：启动 catch-up（sweep due 闹钟/恢复挂起 turn）——catch 住防 unhandled rejection
    nanoMiniCatchUp().catch((e) => console.warn('[nano-mini] catchUp failed:', e))
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
 