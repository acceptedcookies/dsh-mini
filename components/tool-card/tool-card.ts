import type { ToolView } from '../../utils/tool-view'
import { engine } from '../../services/skin/engine'

Component({
  properties: {
    view: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },

  data: {
    layout: '',
    shellVars: '',
    expanded: false,
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
      const shellVars = engine.componentVars('tool-card')
      const layout = engine.componentLayout('tool-card')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    toggle() {
      const view = this.properties.view as ToolView
      if (view.expandable !== true) return
      this.setData({ expanded: !this.data.expanded })
    },

    inspect() {
      const view = this.properties.view as ToolView
      if (view.sourceSeq === undefined) return
      this.triggerEvent('inspect', { seq: view.sourceSeq })
    },
  },
})

export {}
