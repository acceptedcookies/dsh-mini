// 引导页：主包 require 分包文件被模块隔离禁止——导航到此页触发分包下载，
// 页内同包 require 合法，kernel bundle 挂 globalThis 供主包消费面读取，随即回退。
// require 失败仍须回退——否则页卡在引导屏且 loadKernelAsync 轮询至超时（UI 审查 F15）。
Page({
  onReady() {
    try {
      globalThis.__dshKernelBundle = require('../kernel.js')
    } catch (e) {
      globalThis.__dshKernelError = e
    }
    wx.navigateBack()
  },
})
