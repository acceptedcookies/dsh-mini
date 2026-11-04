import { formatMessageClock } from '../../utils/time'

const COPY_RESET_MS = 1600

Component({
  properties: {
    text: { type: String, value: '' },
    theme: { type: String, value: 'light' },
    time: { type: Number, value: 0 },
    clock: { type: String, value: 'none' },
    rating: { type: String, value: '' },
    branch: { type: Boolean, value: false },
    feedback: { type: Boolean, value: false },
  },

  data: {
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
    detached() {
      const timer = this.data.copyTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },

  methods: {
    copy() {
      if (this.properties.text.length === 0) return
      wx.setClipboardData({ data: this.properties.text })
      const timer = this.data.copyTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
      const next = setTimeout(() => {
        this.setData({ copied: false, copyTimer: 0 })
      }, COPY_RESET_MS)
      this.setData({ copied: true, copyTimer: next })
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
