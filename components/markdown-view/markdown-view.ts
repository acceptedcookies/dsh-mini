import { markdownSegments, type MarkdownSegment, type MarkdownTheme } from '../../services/markdown'
import { errorBus } from '../../services/error-report'

const COPIED_MS = 1200

Component({
  properties: {
    text: { type: String, value: '' },
    html: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },
  data: {
    segments: [] as MarkdownSegment[],
    copiedIndex: -1,
    copyTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },
  lifetimes: {
    attached() {
      this.render()
    },
    detached() {
      const timer = this.data.copyTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
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
      const segments = text.length > 0
        ? markdownSegments(text, theme).map((segment) => segment.kind === 'code' ? { ...segment, wrap: true } : segment)
        : this.properties.html.length > 0
          ? [{ kind: 'html', html: this.properties.html } as MarkdownSegment]
          : []
      this.setData({ segments })
    },

    toggleWrap(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const segment = this.data.segments[index]
      if (segment?.kind !== 'code') return
      this.setData({ [`segments[${index}].wrap`]: segment.wrap === false })
    },

    copyCode(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const segment = this.data.segments[index]
      if (segment?.kind !== 'code' || segment.code === undefined) return
      wx.setClipboardData({
        data: segment.code,
        success: () => {
          const timer = this.data.copyTimer as ReturnType<typeof setTimeout> | 0
          if (timer !== 0) clearTimeout(timer)
          this.setData({ copiedIndex: index })
          const next = setTimeout(() => {
            this.setData({ copiedIndex: -1, copyTimer: 0 })
          }, COPIED_MS)
          this.setData({ copyTimer: next })
        },
        fail: (err) => errorBus.report(err, { op: 'clipboard', lane: 'ui' }),
      })
    },
  },
})
