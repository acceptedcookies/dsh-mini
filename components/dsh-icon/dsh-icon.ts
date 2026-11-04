const ACCENT = new Set([
  'check-outline',
  'check-circle-fill',
  'check-circle-outline',
  'plan-outline',
  'loading-outline',
  'sparkle',
  'plus-outline',
  'new-chat-outline',
])

const INVERSE = new Set([
  'paper-plane-outline',
  'stop-fill',
  'check-outline',
  'close-fill',
  'plus-outline',
])

const DANGER = new Set([
  'trash-outline',
  'warning-outline',
  'warning-triangle-outline',
  'close-circle-fill',
  'close-outline',
])

const WARN = new Set([
  'warning-outline',
  'warning-triangle-outline',
])

function resolveTone(name: string, tone: string): string {
  if (tone === 'accent' && !ACCENT.has(name)) return 'secondary'
  if (tone === 'inverse' && !INVERSE.has(name)) return 'primary'
  if (tone === 'danger' && !DANGER.has(name)) return 'secondary'
  if (tone === 'warn' && !WARN.has(name)) return 'danger'
  return tone
}

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
