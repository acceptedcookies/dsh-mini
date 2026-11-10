Page({
  onReady() {
    require('../boot/text-codec.js').installTextCodec()
    // 主包 require 分包文件被模块隔离禁止——本页存在的唯一目的就是
    // 在分包上下文 require kernel.js 并挂到 globalThis 供主包读取。
    // 真机/remote-debug 懒推分包：页可跑时 kernel.js 可能尚未流到，
    // 一次性失败不能当终态（冷推竞态实证）——重试直至超窗再落 error。
    let attempts = 0
    const tryLoad = () => {
      try {
        globalThis.__dshKernelBundle = require('../kernel.js')
        globalThis.__dshKernelManifest = require('../manifest.json')
        wx.navigateBack()
      } catch (e) {
        attempts += 1
        if (attempts >= 12) {
          globalThis.__dshKernelError = e
          wx.navigateBack()
          return
        }
        setTimeout(tryLoad, 500)
      }
    }
    tryLoad()
  },
})
