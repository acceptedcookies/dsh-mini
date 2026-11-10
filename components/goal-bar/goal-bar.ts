import { engine } from '../../services/skin/engine'
Component({
  properties: {
    goal: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },

  data: {
    layout: '',
    shellVars: '',
    editing: false,
    draft: '',
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
      const shellVars = engine.componentVars('goal-bar')
      const layout = engine.componentLayout('goal-bar')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    startEdit() {
      this.setData({ editing: true, draft: this.properties.goal })
    },

    onInput(event: WechatMiniprogram.TextareaInput) {
      this.setData({ draft: event.detail.value })
    },

    save() {
      const value = this.data.draft.trim()
      if (value.length === 0) return
      this.triggerEvent('edit', { value })
      this.setData({ editing: false })
    },

    cancel() {
      this.setData({ editing: false })
    },

    clear() {
      this.triggerEvent('clear')
    },
  },
})

export {}
