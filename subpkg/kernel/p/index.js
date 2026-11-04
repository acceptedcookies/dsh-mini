// 引导页：主包 require 分包文件被模块隔离禁止——导航到此页触发分包下载，
// 页内同包 require 合法，kernel bundle 挂 globalThis 供主包消费面读取，随即回退。
Page({
  onReady() {
    globalThis.__dshKernelBundle = require('../kernel.js')
    wx.navigateBack()
  },
})
