import { filterCommands, type CommandDefinition } from '../../services/commands'

interface MenuRow extends CommandDefinition {
  alias: string
  active: boolean
}

interface MenuGroup {
  key: string
  title: string
  rows: MenuRow[]
}

function buildGroups(query: string): MenuGroup[] {
  const keyword = query.trim()
  const rows = filterCommands(query).map((row, index): MenuRow => ({
    ...row,
    alias: row.name,
    active: index === 0,
  }))
  if (keyword.length === 0) {
    return [
      { key: 'add', title: '添加', rows: rows.filter((row) => row.section === 'add') },
      { key: 'commands', title: '指令', rows: rows.filter((row) => row.section === 'commands') },
    ]
  }
  return rows.length === 0 ? [] : [{ key: 'results', title: '', rows }]
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    query: { type: String, value: '' },
    theme: { type: String, value: 'light' },
    surfaceStyle: { type: String, value: '' },
    maxHeight: { type: Number, value: 400 },
  },

  data: {
    groups: [] as MenuGroup[],
    count: 0,
    viewportHeight: 0,
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
      }, 80)
      this.setData({ exitTimer: next })
    },
    query(query: string) {
      this.rebuild(query)
    },
    maxHeight() {
      this.rebuild(this.data.query as string)
    },
  },

  lifetimes: {
    attached() {
      this.rebuild(this.data.query as string)
    },
    detached() {
      const timer = this.data.exitTimer as ReturnType<typeof setTimeout> | 0
      if (timer !== 0) clearTimeout(timer)
    },
  },

  methods: {
    rebuild(query: string) {
      const groups = buildGroups(query)
      const count = groups.reduce((sum, group) => sum + group.rows.length, 0)
      const titles = groups.filter((group) => group.title.length > 0).length
      const content = 8 + titles * 23 + count * 34
      const maxHeight = this.data.maxHeight as number
      this.setData({
        groups,
        count,
        viewportHeight: Math.max(34, Math.min(maxHeight, content)),
      })
      if (query.trim().length > 0 && count === 0) this.triggerEvent('close')
    },

    onSelect(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id ?? '')
      if (id.length === 0) return
      this.triggerEvent('select', { id })
    },

    close() {
      this.triggerEvent('close')
    },

    noop() {
      // Keeps taps inside the menu from dismissing it.
    },
  },
})
