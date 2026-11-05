/**
 * 向上弹窗抽屉（upDrawer）—— 底上弹抽屉的正式组件。
 * 命名契约：未来需要「底上弹出来的抽屉」时用 upDrawer 唤醒本组件。
 *
 * 壳层契约（业主 MN03 规范）：
 *   - 居中圆形关闭钮（带底色）→ 居中横杠 grab → 标题行 → 内容槽；
 *   - 固定高 = 视口 1/3（33.333vh），内容超出由消费者自带 scroll-view 滚动；
 *   - 底部 env(safe-area-inset-bottom) + 12px 呼吸量——iPhone home 指示条
 *     与 Android 手势条不重叠。
 * 事件：close（遮罩/关闭钮同发）。
 */
const EXIT_MS = 160

Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    theme: { type: String, value: 'light' },
  },

  data: {
    render: false,
    closing: false,
    exitTimer: 0 as ReturnType<typeof setTimeout> | 0,
  },

  observers: {
    visible(visible: boolean) {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) {
        clearTimeout(timer)
        this.setData({ exitTimer: 0 })
      }
      if (visible) {
        this.setData({ render: true, closing: false })
        return
      }
      if (!this.data.render) return
      this.setData({ closing: true })
      const next = setTimeout(() => {
        this.setData({ render: false, closing: false, exitTimer: 0 })
      }, EXIT_MS)
      this.setData({ exitTimer: next })
    },
  },

  lifetimes: {
    detached() {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },

  methods: {
    onMask() {
      this.triggerEvent('close')
    },
    onClose() {
      this.triggerEvent('close')
    },
    noop() {
      // 拦截冒泡——抽屉内触点不穿透遮罩。
    },
  },
})

export {}
