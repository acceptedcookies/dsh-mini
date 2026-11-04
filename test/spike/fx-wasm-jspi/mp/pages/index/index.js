const { runAllProbes } = require("../../probe/probe.js");

Page({
  data: {
    done: false,
    stage: "",
    r: null,
  },
  async onLoad() {
    const stage = (s) => this.setData({ stage: s });
    try {
      const r = await runAllProbes(stage);
      getApp().globalData.probeResult = r;
      this.setData({ done: true, r });
    } catch (e) {
      const r = { fatal: String((e && e.message) || e) };
      getApp().globalData.probeResult = r;
      this.setData({ done: true, r: { apiSurface: {}, echo: {}, bad: {}, asyncToy: {} } });
    }
  },
});
