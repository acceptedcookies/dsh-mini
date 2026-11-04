// app.ts
import { getTheme, watchSystemTheme } from './services/theme'
import { vfs, vfsReadView, vfsStore } from './services/vfs/api'

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
  },
})
 