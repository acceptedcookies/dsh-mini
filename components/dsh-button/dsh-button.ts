import { engine } from '../../services/skin/engine'
Component({
  options: { multipleSlots: true },
  properties: {
    /** primary | ghost | danger | icon | default */
    variant: { type: String, value: 'default' },
    /** md | sm（icon 变体忽略 size） */
    size: { type: String, value: 'md' },
    /** dsh-icon 名称（可选，与 label/slot 并存） */
    icon: { type: String, value: '' },
    iconSize: { type: Number, value: 14 },
    label: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
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
      const shellVars = engine.componentVars('dsh-button')
      const layout = engine.componentLayout('dsh-button')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    onTap() {
      if (!this.data.disabled) this.triggerEvent('tap')
    },
  },
})
