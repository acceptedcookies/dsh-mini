// spike / nano-tools — probe page: builds runtime + wx workspace, runs the
// full 67-row matrix inside mp JSCore, emits console lines + evidence global.
// vendor require is wrapped: if the 1.6MB bundle fails to load on a device
// (parse or eval), the page still renders and surfaces the real error in data.
let createSpikeRuntime = null
let spikeProbeEnv = null
let loadErr = ''
try {
  const vendor = require('../../vendor/spike-runtime.js')
  createSpikeRuntime = vendor.createSpikeRuntime
  spikeProbeEnv = vendor.spikeProbeEnv
} catch (e) {
  loadErr = String((e && (e.stack || e.message)) || e)
}
const { runMatrix } = require('../../lib/driver.js')
const { wxFetch } = require('../../lib/wx-workspace.js')

Page({
  data: { status: 'boot', summary: '', loadErr },
  onLoad() {
    if (loadErr) {
      console.log('[nano-tools] FATAL vendor load: ' + loadErr.split('\n')[0])
      this.setData({ status: 'fatal: vendor load' })
      getApp().globalData.nanoToolsEvidence = { fatal: 'vendor load: ' + loadErr }
      return
    }
    const app = getApp()
    app.globalData = app.globalData || {}
    if (app.globalData.nanoToolsRunning) return
    app.globalData.nanoToolsRunning = true
    app.globalData.nanoToolsEvidence = null
    this.runAll()
  },
  async runAll() {
    const log = (l) => console.log(l)
    try {
      console.log('[nano-tools] BOOT bundle loaded')
      console.log('[nano-tools] ENV ' + JSON.stringify(spikeProbeEnv()))
      const ws = require('../../lib/wx-workspace.js').createWxWorkspace()
      console.log('[nano-tools] STEP ws')
      const rt = createSpikeRuntime(ws, { workspacePath: '/data/spike', fetchImpl: wxFetch, timeoutMs: 30000 })
      console.log('[nano-tools] RUN ids=' + rt.ids.length)
      const evidence = await runMatrix(rt, ws, log)
      getApp().globalData.nanoToolsEvidence = evidence
      this.setData({ status: 'done', summary: JSON.stringify(evidence.summary) })
      console.log('[nano-tools] DONE ' + JSON.stringify(evidence.summary))
      getApp().globalData.nanoToolsRunning = false
      // LAN evidence return: the automator channel never enters true
      // remote-debug mode in this IDE (no remotedebugappservice UA token →
      // appservice code 403 → page JS never arrives), so a device run is
      // collected by POSTing the evidence to the Mac over the same LAN that
      // the phone already reaches. Receiver: run-mp.mjs --listen.
      const EP = 'http://192.168.10.158:8899/evidence'
      let isDevice = false
      try { isDevice = wx.getDeviceInfo().platform !== 'devtools' } catch (e) { }
      if (isDevice) try {
        wx.request({
          url: EP, method: 'POST',
          header: { 'content-type': 'application/json' },
          data: JSON.stringify({ evidence: evidence, at: new Date().toISOString() }),
          success: (r) => console.log('[nano-tools] UPLOAD ok ' + r.statusCode),
          fail: (e) => console.log('[nano-tools] UPLOAD fail ' + ((e && e.errMsg) || 'unknown')),
        })
      } catch (e) { console.log('[nano-tools] UPLOAD threw ' + String(e)) }
    } catch (e) {
      const msg = typeof e === 'object' && e !== null && !e.stack
        ? JSON.stringify(e)
        : String(e && (e.stack || e.message) || e)
      console.log('[nano-tools] FATAL ' + msg.split('\n').slice(0, 6).join(' | '))
      this.setData({ status: 'fatal: ' + msg.slice(0, 200) })
      getApp().globalData.nanoToolsEvidence = { fatal: msg }
      getApp().globalData.nanoToolsRunning = false
    }
  },
})
