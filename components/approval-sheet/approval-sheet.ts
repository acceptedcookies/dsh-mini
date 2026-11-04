Component({
  properties: {
    visible: { type: Boolean, value: false },
    request: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },
  methods: {
    allow() {
      this.respond('allowed-once')
    },
    reject() {
      this.respond('rejected')
    },
    cancel() {
      this.respond('cancelled')
    },
    respond(outcome: string) {
      const request = this.properties.request as { id?: string } | null
      if (request?.id === undefined) return
      this.triggerEvent('respond', { approvalId: request.id, outcome })
    },
    noop() {
      // Prevent taps inside the sheet from closing it.
    },
  },
})
