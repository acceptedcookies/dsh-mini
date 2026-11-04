Component({
  properties: {
    visible: { type: Boolean, value: false },
    request: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },

  data: {
    answered: false,
    answeredId: '',
  },

  observers: {
    request(value: { id?: string } | null) {
      const id = typeof value?.id === 'string' ? value.id : ''
      if (id === this.data.answeredId) return
      this.setData({ answered: false, answeredId: id })
    },
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
      if (request?.id === undefined || this.data.answered) return
      this.setData({ answered: true })
      this.triggerEvent('respond', { approvalId: request.id, outcome })
    },
    noop() {
      // Prevent taps inside the sheet from closing it.
    },
  },
})
