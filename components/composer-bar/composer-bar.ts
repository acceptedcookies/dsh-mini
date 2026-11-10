import { engine } from '../../services/skin/engine'
Component({
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '描述你想要构建的内容' },
    modelLabel: { type: String, value: 'DeepSeek V4.1 Flash' },
    running: { type: Boolean, value: false },
    sending: { type: Boolean, value: false },
    hero: { type: Boolean, value: false },
    images: { type: Array, value: [] },
    theme: { type: String, value: 'light' },
    permissionLabel: { type: String, value: '工作区内修改' },
    planMode: { type: Boolean, value: false },
  },
  data: {
    layout: '',
    shellVars: '',
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
      const shellVars = engine.componentVars('composer-bar')
      const layout = engine.componentLayout('composer-bar')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    onInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('input', {
        value: event.detail.value,
        cursor: event.detail.cursor ?? event.detail.value.length,
      })
    },
    onSend() {
      // 纯图可发（下层 prompt/images 全链路支持）——空文本+无图才拦（UI 审查 F2）。
      if (this.data.sending || (this.data.value.trim().length === 0 && this.data.images.length === 0)) return
      this.triggerEvent('send')
    },
    onStop() {
      this.triggerEvent('stop')
    },
    onAttach() {
      this.triggerEvent('command')
    },
    onModel() {
      this.triggerEvent('model')
    },
    onPermission() {
      this.triggerEvent('permission')
    },
    onRemoveImage(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('removeimage', { index: Number(event.currentTarget.dataset.index) })
    },

    measure(callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
      this.measureSelector('.composer-card', callback)
    },

    measureModel(callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
      this.measureSelector('.composer-model', callback)
    },

    measurePermission(callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
      this.measureSelector('.composer-chip-permission', callback)
    },

    measureSelector(selector: string, callback: (rect: WechatMiniprogram.BoundingClientRectCallbackResult | null) => void) {
      this.createSelectorQuery()
        .select(selector)
        .boundingClientRect((rect) => {
          callback(rect === null ? null : rect as WechatMiniprogram.BoundingClientRectCallbackResult)
        })
        .exec()
    },
  },
})
