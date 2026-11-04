Component({
  properties: {
    item: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },
  methods: {
    onRetry() {
      this.triggerEvent('retry')
    },
    onBranch() {
      this.triggerEvent('branch')
    },
  },
})
