Component({
  properties: {
    text: { type: String, value: '' },
    running: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
  },
  data: {
    expanded: false,
    summary: '',
  },
  observers: {
    text(value: string) {
      const firstLine = value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
      this.setData({ summary: firstLine.split('**').join('').slice(0, 120) })
    },
  },
  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded })
    },
  },
})
