Component({
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },

  methods: {
    toggle() {
      if (this.data.disabled) return
      this.triggerEvent('change', { checked: !this.data.checked })
    },
  },
})
