const { runAllProbes } = require("../../probe/probe.js");

Page({
  data: {
    base: "",
    done: false,
    stage: "waiting for probeConfig (automator) or manual input",
    r: null,
    posted: false,
  },
  onBase(e) {
    this.setData({ base: e.detail.value });
  },
  async runManual() {
    if (this._running) return;
    const base = this.data.base || (getApp().globalData.probeConfig || {}).base;
    if (!base) {
      this.setData({ stage: "no base url" });
      return;
    }
    // manual lane runs all arms; automator lane runs the row-selected subset
    await this._run(base, null);
  },
  copyResult() {
    const r = getApp().globalData.probeResult;
    if (r) {
      wx.setClipboardData({ data: JSON.stringify(r, null, 2) });
    }
  },
  async _run(base, arms) {
    if (this._running) return;
    this._running = true;
    this.setData({ done: false, posted: false, stage: `probing ${base}` });
    const flush = (report) => {
      // incremental evidence: partial results survive a crashed arm
      getApp().globalData.probeResult = report;
      this.setData({ r: report });
    };
    try {
      const r = await runAllProbes(base, (s) => this.setData({ stage: s }), arms, flush);
      flush(r);
      this.setData({ done: true, stage: "done" });
      // device lane evidence channel: best-effort POST back to the mock so the
      // full JSON lands on disk without manual transcription; clipboard stays
      // as fallback (copyResult button).
      try {
        httpPost(`${base}/report`, r);
        this.setData({ posted: true });
      } catch {}
    } catch (e) {
      const r = { fatal: String((e && e.message) || e) };
      getApp().globalData.probeResult = r;
      this.setData({ done: true, r: { apiSurface: {} } });
    } finally {
      this._running = false;
    }
  },
  onLoad() {
    // automator lane: poll globalData.probeConfig; when injected, run once.
    this._timer = setInterval(async () => {
      const cfg = getApp().globalData.probeConfig;
      if (cfg && cfg.base && !this._started) {
        this._started = true;
        clearInterval(this._timer);
        this.setData({ base: cfg.base });
        await this._run(cfg.base, cfg.arms);
      }
    }, 300);
    // device lane fallback: stop polling after 25s, manual input stays available.
    setTimeout(() => {
      if (this._timer && !this._started) {
        clearInterval(this._timer);
        this._timer = null;
        this.setData({ stage: "enter mock base url (e.g. http://<LAN-IP>:<port>)" });
      }
    }, 25000);
  },
  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },
});

function httpPost(url, obj) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "POST",
      data: JSON.stringify(obj),
      header: { "content-type": "application/json" },
      success: resolve,
      fail: reject,
    });
  });
}
