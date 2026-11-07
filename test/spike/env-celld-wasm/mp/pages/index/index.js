const { runAllProbes } = require("../../probe/probe.js");

// 结果回传端点：preview 真机跑完后 POST 到开发机局域网 IP（urlCheck=false 已关校验）
const RESULT_ENDPOINT = "http://192.168.10.158:18081/probe";

Page({
  data: { done: false, stage: "", r: null },
  async onLoad() {
    const stage = (s) => this.setData({ stage: s });
    let r;
    try {
      r = await runAllProbes(stage);
    } catch (e) {
      r = { fatal: String((e && e.message) || e) };
    }
    try {
      r.device = wx.getDeviceInfo();
      r.base = wx.getAppBaseInfo();
    } catch {}
    getApp().globalData.probeResult = r;
    this.setData({ done: true, r });
    try {
      wx.request({
        url: RESULT_ENDPOINT,
        method: "POST",
        data: r,
        timeout: 15000,
        success() {},
        fail() {},
      });
    } catch {}
  },
});
