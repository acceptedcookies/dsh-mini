// app.ts
import { getTheme, watchSystemTheme } from './services/theme'
import { vfs, vfsReadView, vfsStore } from './services/vfs/api'
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from './services/nano-mini-host/tick'
import { vfsRemoteFor, vfsSyncFor, ioStateFor } from './services/state/provider'

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
 