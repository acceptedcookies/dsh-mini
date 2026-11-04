const EXIT_MS = 150

Component({
  properties: {
    visible: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
    tone: { type: String, value: 'default' },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    editable: { type: Boolean, value: false },
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    cancelText: { type: String, value: '取消' },
    confirmText: { type: String, value: '确定' },
    danger: { type: Boolean, value: false },
    confirmDisabled: { type: Boolean, value: false },
  },

  data: {
    draft: '',
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
    'visible, value'(visible: boolean, value: string) {
      if (visible) this.setData({ draft: value })
    },
  },

  lifetimes: {
    detached() {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },

  methods: {
    noop() {
      // Keeps taps inside the dialog from dismissing it.
    },

    onInput(event: WechatMiniprogram.Input) {
      this.setData({ draft: event.detail.value })
    },

    cancel() {
      this.triggerEvent('cancel')
    },

    confirm() {
      if (this.data.confirmDisabled) return
      this.triggerEvent('confirm', { value: this.data.draft as string })
    },
  },
})

export {}
