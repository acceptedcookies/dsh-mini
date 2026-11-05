const EXIT_MS = 200

Component({
  properties: {
    visible: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
    tone: { type: String, value: 'default' },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    editable: { type: Boolean, value: false },
    /** 多行编辑面（目标等长文）：editable 时渲染 textarea 而非 input。 */
    multiline: { type: Boolean, value: false },
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
    /** 原生键盘高度：弹层 input/textarea 一律 adjust-position=false（不顶页），
     *  由层内 padding-bottom 把卡片抬到键盘上沿（业主 MN04 统一键盘策略）。 */
    kb: 0,
    kbHandler: undefined as ((res: { height: number }) => void) | undefined,
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
    attached() {
      const handler = (result: { height: number }) => {
        const kb = Math.max(0, Math.round(result.height))
        if (kb !== this.data.kb) this.setData({ kb })
      }
      this.setData({ kbHandler: handler })
      wx.onKeyboardHeightChange(handler)
    },
    detached() {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
      const handler = this.data.kbHandler
      if (handler !== undefined) {
        wx.offKeyboardHeightChange(handler)
        this.setData({ kbHandler: undefined })
      }
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
