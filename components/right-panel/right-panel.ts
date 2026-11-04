interface RightTab {
  id: string
  label: string
  icon: string
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    active: { type: String, value: 'files' },
    tabs: { type: Array, value: [] },
    theme: { type: String, value: 'light' },
    files: { type: Array, value: [] },
    todos: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
    connected: { type: Boolean, value: false },
  },
  methods: {
    select(event: WechatMiniprogram.CustomEvent<{ id?: string }>) {
      const id = String(event.detail?.id ?? '')
      if (id.length > 0) this.triggerEvent('select', { id })
    },
    close() {
      this.triggerEvent('close')
    },
    refresh() {
      this.triggerEvent('refresh')
    },
    noop() {
      // Keep taps inside the panel from reaching the page.
    },
  },
})
