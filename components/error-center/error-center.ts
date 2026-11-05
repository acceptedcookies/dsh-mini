import { reportText, type ErrorReport, type ErrorSeverity } from '../../services/error-report'

/** severity → 自动关闭时长（悬浮 toast 语义：轻提醒短停，错误长停）。 */
const DURATION: Record<ErrorSeverity, number> = {
  info: 3000,
  warn: 5000,
  error: 6000,
  fatal: 8000,
}

function iconOf(severity: ErrorSeverity): { name: string; tone: string } {
  if (severity === 'warn') return { name: 'warning-outline', tone: 'warn' }
  if (severity === 'info') return { name: 'info-outline', tone: 'secondary' }
  return { name: 'warning-triangle-outline', tone: 'danger' }
}

interface ToastView extends ErrorReport {
  iconName: string
  iconTone: string
}

interface DiagRow {
  k: string
  v: string
}

Component({
  properties: {
    toasts: { type: Array, value: [] as ErrorReport[] },
    modal: { type: Object, value: null as ErrorReport | null },
    theme: { type: String, value: 'light' },
  },

  data: {
    toastViews: [] as ToastView[],
    modalRows: [] as DiagRow[],
    modalDetail: '',
    modalText: '',
    modalIconName: 'warning-triangle-outline',
    modalIconTone: 'danger',
  },

  observers: {
    toasts(list: ErrorReport[]) {
      const alive = new Set(list.map((r) => r.id))
      const timers = (this as unknown as { _timers: Map<string, ReturnType<typeof setTimeout>> })._timers
      for (const [id, t] of timers) {
        if (!alive.has(id)) {
          clearTimeout(t)
          timers.delete(id)
        }
      }
      for (const report of list) {
        if (!timers.has(report.id)) {
          const timer = setTimeout(() => {
            timers.delete(report.id)
            this.triggerEvent('closetoast', { id: report.id })
          }, DURATION[report.severity] ?? 5000)
          timers.set(report.id, timer)
        }
      }
      this.setData({
        toastViews: list.map((r) => {
          const icon = iconOf(r.severity)
          return { ...r, iconName: icon.name, iconTone: icon.tone }
        }),
      })
    },
    modal(report: ErrorReport | null) {
      if (report === null) {
        if (this.data.modalRows.length > 0 || this.data.modalDetail !== '' || this.data.modalText !== '') {
          this.setData({ modalRows: [], modalDetail: '', modalText: '' })
        }
        return
      }
      const d = report.diagnostics
      const pairs: Array<[string, unknown]> = [
        ['code', report.code],
        ['category', report.category],
        ['op', d.op],
        ['lane', d.lane],
        ['route', d.route],
        ['model', d.model],
        ['session', d.sessionId],
        ['status', d.status],
        ['retryable', d.retryable],
        ['count', report.count > 1 ? report.count : undefined],
        ['time', new Date(report.ts).toLocaleString()],
      ]
      const rows: DiagRow[] = pairs
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => ({ k, v: String(v) }))
      const detail = [d.detail, d.stack].filter((s) => s !== undefined && s.length > 0).join('\n\n')
      const icon = iconOf(report.severity)
      this.setData({ modalRows: rows, modalDetail: detail, modalText: reportText(report), modalIconName: icon.name, modalIconTone: icon.tone })
    },
  },

  lifetimes: {
    created() {
      ;(this as unknown as { _timers: Map<string, ReturnType<typeof setTimeout>> })._timers = new Map()
    },
    detached() {
      const timers = (this as unknown as { _timers?: Map<string, ReturnType<typeof setTimeout>> })._timers
      if (timers !== undefined) {
        for (const t of timers.values()) clearTimeout(t)
        timers.clear()
      }
    },
  },

  methods: {
    noop() {},

    onDismissToast(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id ?? '')
      if (id.length > 0) this.triggerEvent('closetoast', { id })
    },

    onOpenDetail(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id ?? '')
      if (id.length > 0) this.triggerEvent('detail', { id })
    },

    onCloseModal() {
      this.triggerEvent('closemodal')
    },

    onCopy() {
      const text = this.data.modalText as string
      if (text.length === 0) return
      wx.setClipboardData({
        data: text,
        success: () => this.triggerEvent('copied'),
        fail: () => this.triggerEvent('copyfailed'),
      })
    },
  },
})
