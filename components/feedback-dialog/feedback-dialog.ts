const EXIT_MS = 150

const CATEGORIES = [
  { id: 'task-result', label: '任务结果' },
  { id: 'instruction-following', label: '指令理解与遵循' },
  { id: 'product-interaction', label: '产品功能与交互' },
  { id: 'service-stability', label: '稳定性和速度' },
  { id: 'resource-cost', label: '资源使用与费用' },
  { id: 'security-privacy-permission', label: '安全隐私与权限' },
  { id: 'other', label: '其他' },
]

Component({
  properties: {
    visible: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
    rating: { type: String, value: 'positive' },
    target: { type: String, value: '' },
    submitting: { type: Boolean, value: false },
  },

  data: {
    categories: CATEGORIES,
    category: '',
    draft: '',
    lastTarget: '',
    render: false,
    closing: false,
    exitTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },

  observers: {
    'visible, target'(visible: boolean, target: string) {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) {
        clearTimeout(timer)
        this.setData({ exitTimer: 0 })
      }
      if (visible) {
        if (target !== this.data.lastTarget) {
          this.setData({ render: true, closing: false, category: '', draft: '', lastTarget: target })
          return
        }
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
    noop() {
      // Keeps taps inside the card from dismissing it.
    },

    onInput(event: WechatMiniprogram.TextareaInput) {
      this.setData({ draft: event.detail.value })
    },

    selectCategory(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id ?? '')
      this.setData({ category: this.data.category === id ? '' : id })
    },

    cancel() {
      this.triggerEvent('cancel')
    },

    submit() {
      if (this.properties.submitting) return
      this.triggerEvent('submit', {
        rating: this.properties.rating,
        category: this.data.category,
        text: this.data.draft.trim(),
      })
    },
  },
})

export {}
