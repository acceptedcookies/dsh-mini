Component({
  options: { multipleSlots: true },
  properties: {
    /** primary | ghost | danger | icon | default */
    variant: { type: String, value: 'default' },
    /** md | sm（icon 变体忽略 size） */
    size: { type: String, value: 'md' },
    /** dsh-icon 名称（可选，与 label/slot 并存） */
    icon: { type: String, value: '' },
    iconSize: { type: Number, value: 14 },
    label: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
  },
  methods: {
    onTap() {
      if (!this.data.disabled) this.triggerEvent('tap')
    },
  },
})
