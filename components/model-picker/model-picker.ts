import { engine } from '../../services/skin/engine'
const EXIT_MS = 80

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
    layout: '',
    shellVars: '',
    render: false,
    closing: false,
    exitTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },
  observers: {
    surfaceStyle() {
      this.syncShell()
    },
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
    attached() {
      ;(this as unknown as { _unwatchSkin?: () => void })._unwatchSkin = engine.watchMode(() => {
        this.syncShell()
      })
      this.syncShell()
    },
    detached() {
      const unwatch = (this as unknown as { _unwatchSkin?: () => void })._unwatchSkin
      if (typeof unwatch === 'function') unwatch()
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },
  methods: {
    syncShell() {
      const vars = engine.componentVars('model-picker')
      const layout = engine.componentLayout('model-picker')
      const surface = String(this.data.surfaceStyle ?? '')
      const shellVars = [vars, surface].filter((part) => part.length > 0).join('; ')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
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
