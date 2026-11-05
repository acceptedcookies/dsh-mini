Component({
  properties: {
    /** [{id, label, icon?}] */
    tabs: { type: Array, value: [] as Array<{ id: string; label: string; icon?: string }> },
    active: { type: String, value: '' },
    /** underline | pill */
    variant: { type: String, value: 'underline' },
    /** normal | compact | flush（仅 underline：页级大间距 / 面板级紧凑 / 贴槽边——upDrawer 抽屉内用，横向零内距、分隔线=容器宽） */
    density: { type: String, value: 'normal' },
    /** 图标主题（pill+icon 时透传 dsh-icon） */
    theme: { type: String, value: 'light' },
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as { id?: string }).id
      if (id !== undefined && id !== this.data.active) {
        this.triggerEvent('change', { id })
      }
    },
  },
})
