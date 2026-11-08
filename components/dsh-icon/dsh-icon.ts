import { resolveTone } from './dsh-icon.tones'

Component({
  properties: {
    name: { type: String, value: '' },
    tone: { type: String, value: 'secondary' },
    theme: { type: String, value: 'light' },
    size: { type: Number, value: 16 },
  },

  data: {
    src: '',
  },

  observers: {
    'name, tone, theme'(name: string, tone: string, theme: string) {
      if (name.length === 0) {
        this.setData({ src: '' })
        return
      }
      const resolvedTheme = theme === 'dark' ? 'dark' : 'light'
      const resolvedTone = resolveTone(name, tone)
      this.setData({ src: `/assets/icons/${resolvedTheme}/${resolvedTone}/${name}.svg` })
    },
  },
})
