import { markdownToHtml, type MarkdownTheme } from '../../services/markdown'

Component({
  properties: {
    text: { type: String, value: '' },
    html: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },
  data: {
    rendered: '',
  },
  lifetimes: {
    attached() {
      this.render()
    },
  },
  observers: {
    'text, html, theme'() {
      this.render()
    },
  },
  methods: {
    render() {
      const text = this.properties.text
      const theme = this.properties.theme as MarkdownTheme
      this.setData({ rendered: text.length > 0 ? markdownToHtml(text, theme) : this.properties.html })
    },
  },
})
