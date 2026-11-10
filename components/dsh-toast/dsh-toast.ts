import { engine } from '../../services/skin/engine'
Component({
  properties: {
    visible: { type: Boolean, value: false },
    message: { type: String, value: '' },
    tone: { type: String, value: 'info' },
    theme: { type: String, value: 'light' },
    duration: { type: Number, value: 3000 },
  },

  data: {
    layout: '',
    shellVars: '',
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
    attached() {
      ;(this as unknown as { _unwatchSkin?: () => void })._unwatchSkin = engine.watchMode(() => {
        this.syncShell()
      })
      this.syncShell()
    },
    detached() {
      const unwatch = (this as unknown as { _unwatchSkin?: () => void })._unwatchSkin
      if (typeof unwatch === 'function') unwatch()
      this.clearTimer()
      const exitTimer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (exitTimer !== 0) clearTimeout(exitTimer)
    },
  },

  methods: {
    syncShell() {
      const shellVars = engine.componentVars('dsh-toast')
      const layout = engine.componentLayout('dsh-toast')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    clearTimer() {
      const timer = this.data.timer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
      this.setData({ timer: 0 })
    },
  },
})
