// app.ts
import { getTheme, watchSystemTheme } from './services/theme'
import { vfs, vfsReadView, vfsStore } from './services/vfs/api'
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from './services/nano-mini-host/tick'

App<IAppOption>({
  globalData: {
    theme: getTheme(),
    /** VFS 测试钩子：automator evaluate 经 getApp().globalData.__vfs 直达。 */
    __vfs: { vfs, vfsReadView, vfsStore } as unknown,
  },
  onLaunch() {
    watchSystemTheme((theme) => {
      this.globalData.theme = theme
    })
    // T-O-9：启动 catch-up（sweep due 闹钟/恢复挂起 turn）
    void nanoMiniCatchUp()
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
 