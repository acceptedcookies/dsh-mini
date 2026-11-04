const EXIT_MS = 120

Component({
  properties: {
    visible: { type: Boolean, value: false },
    models: { type: Array, value: [] },
    current: { type: String, value: '' },
    providerLabel: { type: String, value: 'DeepSeek' },
    surfaceStyle: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },
  data: {
    render: false,
    closing: false,
    exitTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },
  observers: {
    visible(visible: boolean) {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) {
        clearTimeout(timer)
        this.setData({ exitTimer: 0 })
      }
      if (visible) {
        this.setData({ render: true, closing: false })
        return
      }
      if (!this.data.render) return
      this.setData({ closing: true })
      const next = setTimeout(() => {
        this.setData({ render: false, closing: false, exitTimer: 0 })
      }, EXIT_MS)
      this.setData({ exitTimer: next })
    },
  },
  lifetimes: {
    detached() {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },
  methods: {
    select(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id)
      this.triggerEvent('select', { id })
    },
    close() {
      this.triggerEvent('close')
    },
    noop() {
      // Keep taps inside the menu from bubbling to the dismiss layer.
    },
  },
})

export {}
