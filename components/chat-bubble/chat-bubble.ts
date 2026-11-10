import { errorBus } from '../../services/error-report'
import { engine } from '../../services/skin/engine'

Component({
  properties: {
    item: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
    ratings: { type: Object, value: {} },
  },

  data: {
    layout: '',
    shellVars: '',
    rating: '',
    diffLines: [] as Array<{ text: string; kind: string }>,
  },

  observers: {
    'item, ratings'(item: { id?: string }, ratings: Record<string, string>) {
      const id = typeof item?.id === 'string' ? item.id : ''
      const rating = id.length > 0 ? ratings[id] ?? '' : ''
      if (rating !== this.data.rating) this.setData({ rating })
    },
    item(item: { kind?: string; text?: string }) {
      if (item?.kind !== 'diff') return
      const diffLines = (item.text ?? '').split('\n').map((line) => {
        const kind = line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')
          ? 'hunk'
          : line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'del'
              : 'context'
        return {
          text: kind === 'add' || kind === 'del' ? line.slice(1) : line,
          kind,
        }
      })
      this.setData({ diffLines })
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
    },
  },
  methods: {
    syncShell() {
      const shellVars = engine.componentVars('chat-bubble')
      const layout = engine.componentLayout('chat-bubble')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    onPreview(event: WechatMiniprogram.TouchEvent) {
      const url = String(event.currentTarget.dataset.url ?? '')
      if (url.length === 0) return
      // 预览列表与渲染同序：durable imageParts 优先，images 回退——
      // 原只取 images 致跨启动消息后 urls 为空、滑动到死临时路径（审查八轮 D6）。
      const item = this.properties.item as { images?: Array<{ url: string }>; imageParts?: Array<{ url: string }> }
      // 空数组不得遮蔽 images——`??` 只在 undefined 回退（审查九轮 D6-fragile）。
      const sources = item.imageParts !== undefined && item.imageParts.length > 0 ? item.imageParts : (item.images ?? [])
      wx.previewImage({
        current: url,
        urls: sources.map((image) => image.url),
        fail: (err) => errorBus.report(err, { op: 'preview-image', lane: 'ui' }),
      })
    },

    onFeedback(event: WechatMiniprogram.CustomEvent<{ rating: string }>) {
      this.triggerEvent('feedback', {
        messageId: (this.properties.item as { id?: string }).id ?? '',
        rating: event.detail.rating,
      })
    },

    onBranch() {
      this.triggerEvent('branch')
    },

    onInspect(event: WechatMiniprogram.CustomEvent<{ seq: number }>) {
      this.triggerEvent('inspect', event.detail)
    },
  },
})
