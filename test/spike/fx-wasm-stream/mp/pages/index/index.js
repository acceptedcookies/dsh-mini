const { runStreamProbe } = require("../../probe/stream-probe.js");

Page({
  data: {
    url: "",
    done: false,
    stage: "waiting for targetUrl (automator) or manual input",
    r: null,
  },
  onUrl(e) {
    this.setData({ url: e.detail.value });
  },
  async runFull() {
    await this._run(false);
  },
  async runAbort() {
    await this._run(true);
  },
  async _run(abort) {
    const url = this.data.url || getApp().globalData.targetUrl;
    if (!url) {
      this.setData({ stage: "no url" });
      return;
    }
    this.setData({ done: false, stage: `requesting ${url}` });
    const r = await runStreamProbe(url, { abortAfterFirst: abort });
    getApp().globalData.probeResult = r;
    this.setData({ done: true, r });
  },
  onLoad() {
    // automator lane: poll globalData.targetUrl; when set, run full probe once.
    this._timer = setInterval(async () => {
      const url = getApp().globalData.targetUrl;
      if (url && !this._started) {
        this._started = true;
        clearInterval(this._timer);
        this.setData({ url });
        await this._run(false);
      }
    }, 300);
  },
  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },
});
