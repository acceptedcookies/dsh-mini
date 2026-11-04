// 引导页：导航触发 fx 分包下载（wasm.instantiate 前的就绪路径），置全局标记后回退。
Page({
  onReady() {
    globalThis.__dshSubpkgFxReady = true
    wx.navigateBack()
  },
})
