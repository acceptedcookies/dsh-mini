function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** First line of the last paragraph that already has a line break (dsh preview). */
function latestCompletedParagraph(text: string): string {
  const paragraphs = text.split(/\r?\n(?:[\t ]*\r?\n)+/)
  let summary = ''
  for (let index = 0; index < paragraphs.length - 1; index += 1) {
    const candidate = firstLine(paragraphs[index] ?? '').trim()
    if (candidate.length > 0) summary = candidate
  }
  return summary
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
      const summary = running ? latestCompletedParagraph(value) : firstLine(value)
      this.setData({ summary: summary.split('**').join('').slice(0, 120) })
    },
  },
  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded })
    },
  },
})
