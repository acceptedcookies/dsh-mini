function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** dsh's streaming preview: the first line of the last paragraph that has one. */
function latestCompletedParagraphFirstLine(text: string): string {
  let summary = ''
  let paragraphStart = 0
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g
  while (true) {
    const nextParagraph = separator.exec(text)
    const paragraphEnd = nextParagraph === null
      ? text.length
      : nextParagraph.index + nextParagraph[0].indexOf('\n')
    const newline = text.indexOf('\n', paragraphStart)
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim()
      if (candidate !== '') summary = candidate
    }
    if (nextParagraph === null) return summary
    paragraphStart = nextParagraph.index + nextParagraph[0].length
  }
}

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
    'text, running'(value: string, running: boolean) {
      const summary = running ? latestCompletedParagraphFirstLine(value) : firstLine(value)
      this.setData({ summary: summary.split('**').join('').slice(0, 120) })
    },
  },
  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded })
    },
  },
})
