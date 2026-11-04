// app.ts
import { getTheme, watchSystemTheme } from './services/theme'
import { vfs, vfsReadView, vfsStore } from './services/vfs/api'
import { nanoMiniCatchUp, nanoMiniStartTick, nanoMiniStopTick } from './services/nano-mini-host/tick'
import { ensureSubpackage } from './services/subpackage'
import { kernelLoaderReset } from './services/nano-mini-host/kernel-loader'

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
    // 纯资源分包（pages:[]）真机不自动下载——启动即预热 kernel/fxcore；
    // kernel 下载完成后复位探测缓存（launch 早期 require 失败会毒化 tried 标记）
    ensureSubpackage('kernel')
      .then(() => kernelLoaderReset())
      .catch((e) => console.warn('[subpackage] kernel 预热失败:', e))
    ensureSubpackage('fxcore').catch((e) => console.warn('[subpackage] fxcore 预热失败:', e))
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
 