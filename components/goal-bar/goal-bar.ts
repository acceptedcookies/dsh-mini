Component({
  properties: {
    goal: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },

  data: {
    editing: false,
    draft: '',
  },

  methods: {
    startEdit() {
      this.setData({ editing: true, draft: this.properties.goal })
    },

    onInput(event: WechatMiniprogram.Input) {
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
