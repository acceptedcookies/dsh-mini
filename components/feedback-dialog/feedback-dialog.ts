import { engine } from '../../services/skin/engine'
const EXIT_MS = 200

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
    layout: '',
    shellVars: '',
    categories: CATEGORIES,
    category: '',
    draft: '',
    render: false,
    closing: false,
    exitTimer: 0 as ReturnType<typeof setTimeout> | 0,
    /** 原生键盘高度：textarea adjust-position=false（不顶页），由层内
     *  padding-bottom 把卡片抬到键盘上沿（业主 MN04 统一键盘策略）。 */
    kb: 0,
    kbHandler: undefined as ((res: { height: number }) => void) | undefined,
  },

  observers: {
    'visible, target'(visible: boolean) {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) {
        clearTimeout(timer)
        this.setData({ exitTimer: 0 })
      }
      if (visible) {
        // dsh opens every feedback target with an empty draft.
        this.setData({ render: true, closing: false, category: '', draft: '' })
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
    attached() {
      ;(this as unknown as { _unwatchSkin?: () => void })._unwatchSkin = engine.watchMode(() => {
        this.syncShell()
      })
      this.syncShell()
      const handler = (result: { height: number }) => {
        const kb = Math.max(0, Math.round(result.height))
        if (kb !== this.data.kb) this.setData({ kb })
      }
      this.setData({ kbHandler: handler })
      wx.onKeyboardHeightChange(handler)
    },
    detached() {
      const unwatch = (this as unknown as { _unwatchSkin?: () => void })._unwatchSkin
      if (typeof unwatch === 'function') unwatch()
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
    syncShell() {
      const shellVars = engine.componentVars('feedback-dialog')
      const layout = engine.componentLayout('feedback-dialog')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
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
