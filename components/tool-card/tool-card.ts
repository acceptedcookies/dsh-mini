import type { ToolView } from '../../utils/tool-view'

Component({
  properties: {
    view: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },

  data: {
    expanded: false,
  },

  methods: {
    toggle() {
      const view = this.properties.view as ToolView
      if (view.expandable !== true) return
      this.setData({ expanded: !this.data.expanded })
    },
  },
})

export {}
