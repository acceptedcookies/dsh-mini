Component({
  properties: {
    visible: { type: Boolean, value: false },
    message: { type: String, value: '' },
    tone: { type: String, value: 'info' },
    theme: { type: String, value: 'light' },
    duration: { type: Number, value: 3000 },
  },

  data: {
    timer: 0 as ReturnType<typeof setTimeout> | 0,
    render: false,
    closing: false,
    exitTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },

  observers: {
    visible(visible: boolean) {
      this.clearTimer()
      const exitTimer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (exitTimer !== 0) {
        clearTimeout(exitTimer)
        this.setData({ exitTimer: 0 })
      }
      if (visible) {
        this.setData({ render: true, closing: false })
        const timer = setTimeout(() => {
          this.setData({ timer: 0 })
          this.triggerEvent('close')
        }, this.data.duration)
        this.setData({ timer })
        return
      }
      if (!this.data.render) return
      this.setData({ closing: true })
      const next = setTimeout(() => {
        this.setData({ render: false, closing: false, exitTimer: 0 })
      }, 1000)
      this.setData({ exitTimer: next })
    },
  },

  lifetimes: {
    detached() {
      this.clearTimer()
      const exitTimer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (exitTimer !== 0) clearTimeout(exitTimer)
    },
  },

  methods: {
    clearTimer() {
      const timer = this.data.timer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
      this.setData({ timer: 0 })
    },
  },
})
