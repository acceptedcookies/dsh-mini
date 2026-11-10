import { formatMessageClock } from '../../utils/time'
import { errorBus } from '../../services/error-report'
import { engine } from '../../services/skin/engine'

const COPY_RESET_MS = 1600

Component({
  externalClasses: ['ext-class'],
  properties: {
    text: { type: String, value: '' },
    theme: { type: String, value: 'light' },
    time: { type: Number, value: 0 },
    clock: { type: String, value: 'none' },
    rating: { type: String, value: '' },
    branch: { type: Boolean, value: false },
    branchUnavailable: { type: Boolean, value: false },
    feedback: { type: Boolean, value: false },
  },

  data: {
    layout: '',
    shellVars: '',
    copied: false,
    clockText: '',
    copyTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },

  observers: {
    time(time: number) {
      this.setData({ clockText: time > 0 ? formatMessageClock(time) : '' })
    },
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
      const timer = this.data.copyTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },

  methods: {
    syncShell() {
      const shellVars = engine.componentVars('message-actions')
      const layout = engine.componentLayout('message-actions')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    copy() {
      if (this.properties.text.length === 0) return
      wx.setClipboardData({
        data: this.properties.text,
        success: () => {
          const timer = this.data.copyTimer as ReturnType<typeof setTimeout> | 0
          if (timer !== 0) clearTimeout(timer)
          const next = setTimeout(() => {
            this.setData({ copied: false, copyTimer: 0 })
          }, COPY_RESET_MS)
          this.setData({ copied: true, copyTimer: next })
        },
        fail: (err) => errorBus.report(err, { op: 'clipboard', lane: 'ui' }),
      })
    },

    like() {
      this.triggerEvent('feedback', { rating: 'positive' })
    },

    dislike() {
      this.triggerEvent('feedback', { rating: 'negative' })
    },

    branch() {
      this.triggerEvent('branch')
    },
  },
})
