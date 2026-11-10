import { engine } from '../../services/skin/engine'
Component({
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },

  data: {
    layout: '',
    shellVars: '',
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
    },
  },
  methods: {
    syncShell() {
      const shellVars = engine.componentVars('dsh-switch')
      const layout = engine.componentLayout('dsh-switch')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    toggle() {
      if (this.data.disabled) return
      this.triggerEvent('change', { checked: !this.data.checked })
    },
  },
})
