Component({
  properties: {
    text: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },
  methods: {
    copy() {
      if (this.properties.text.length === 0) return
      wx.setClipboardData({ data: this.properties.text })
    },
    retry() {
      this.triggerEvent('retry')
    },
    branch() {
      this.triggerEvent('branch')
    },
  },
})
