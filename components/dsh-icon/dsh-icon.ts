import { resolveTone } from './dsh-icon.tones'
import { engine } from '../../services/skin/engine'

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

  lifetimes: {
    attached() {
      ;(this as unknown as { _unwatchSkin?: () => void })._unwatchSkin = engine.watchMode(() => {
        this.syncShell()
      })
      this.syncShell()
    },
    detached() {
      const unwatch = (this as unknown as { _unwatchSkin?: () => void })._unwatchSkin
      if (typeof unwatch === 'function') unwatch()
    },
  },
  methods: {
    syncShell() {
      engine.componentVars('dsh-icon')
      engine.componentLayout('dsh-icon')
    },
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
