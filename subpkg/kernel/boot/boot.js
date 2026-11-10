// kernel 分包引导组件——替代 navigateTo 占位页的无闪分包加载通道。
// 分包上下文内 require kernel.js 合法（主包路径被模块隔离禁止），
// 组件挂载由 usingComponents 声明驱动、随分包流到自动实例化，
// 全程无路由跳变=无闪屏（占位页 navigateTo 白闪根因的根治）。
Component({
  attached() {
    if (globalThis.__dshKernelBundle !== undefined) return
    require('./text-codec.js').installTextCodec()
    let attempts = 0
    const tryLoad = () => {
      try {
        globalThis.__dshKernelBundle = require('../kernel.js')
        globalThis.__dshKernelManifest = require('../manifest.js')
      } catch (e) {
        attempts += 1
        if (attempts >= 12) {
          globalThis.__dshKernelError = e
          return
        }
        setTimeout(tryLoad, 500)
      }
    }
    tryLoad()
  },
})
