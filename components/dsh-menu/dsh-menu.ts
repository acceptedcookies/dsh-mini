import { engine } from '../../services/skin/engine'
const EXIT_MS = 80

Component({
  properties: {
    visible: { type: Boolean, value: false },
    items: { type: Array, value: [] },
    title: { type: String, value: '' },
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
      const vars = engine.componentVars('dsh-menu')
      const layout = engine.componentLayout('dsh-menu')
      const surface = String(this.data.surfaceStyle ?? '')
      const shellVars = [vars, surface].filter((part) => part.length > 0).join('; ')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    close() {
      this.triggerEvent('close')
    },

    noop() {
      // Keeps pointer events from reaching the dismiss layer.
    },

    onSelect(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id ?? '')
      const item = (this.data.items as Array<{ id: string; disabled?: boolean }>)
        .find((candidate) => candidate.id === id)
      if (id.length === 0 || item?.disabled === true) return
      this.triggerEvent('select', { id })
    },
  },
})

export {}
