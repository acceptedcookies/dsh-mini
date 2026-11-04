Page({
  data: { report: null },
  onLoad() {
    const report = { loaded: false, exports: 0, calls: {}, errors: [] };
    try {
      const kernel = require('../../lib/kernel.js');
      report.loaded = true;
      report.exports = Object.keys(kernel).length;
      report.calls.canonicalJson = kernel.canonicalJson({ b: 1, a: [3, 2] });
      report.calls.kernelVersion = kernel.KERNEL_VERSION;
    } catch (e) {
      report.errors.push(String(e && e.message || e));
      report.errors.push(String(e && e.stack || '').split('\n').slice(0, 8).join('|'));
    }
    this.setData({ report });
  },
})
