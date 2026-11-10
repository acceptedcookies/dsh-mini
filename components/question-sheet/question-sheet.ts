import { engine } from '../../services/skin/engine'
interface QuestionOptionView {
  id: string
  label: string
  detail?: string
  recommended: boolean
  selected: boolean
}

interface QuestionView {
  id: string
  text: string
  multiple: boolean
  options: QuestionOptionView[]
  custom: string
  skipped: boolean
}

interface QuestionSource {
  id: string
  text: string
  multiple?: boolean
  custom?: boolean
  options: Array<{ id: string; label: string; detail?: string }>
}

const RECOMMENDED = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

function splitLabel(label: string): { label: string; recommended: boolean } {
  return RECOMMENDED.test(label)
    ? { label: label.replace(RECOMMENDED, ''), recommended: true }
    : { label, recommended: false }
}

function answered(question: QuestionView): boolean {
  return question.options.some((option) => option.selected) || question.custom.trim().length > 0
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    request: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },

  data: {
    layout: '',
    shellVars: '',
    view: [] as QuestionView[],
    index: 0,
    error: '',
    current: null as QuestionView | null,
    progress: '',
    primaryLabel: '提交',
    primaryDisabled: true,
  },

  observers: {
    request(value: unknown) {
      this.build(value as { id?: string; questions?: QuestionSource[] } | null)
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
      const shellVars = engine.componentVars('question-sheet')
      const layout = engine.componentLayout('question-sheet')
      if (shellVars === this.data.shellVars && layout === this.data.layout) return
      this.setData({ shellVars, layout })
    },
    build(request: { id?: string; questions?: QuestionSource[] } | null) {
      const questions = request?.questions
      if (questions === undefined) {
        this.setData({ view: [], index: 0, error: '' })
        this.present(0)
        return
      }
      const view = questions.map((question) => {
        const multiple = question.multiple === true
        const options = question.options.map((option) => {
          const parsed = splitLabel(option.label)
          return { ...option, label: parsed.label, recommended: parsed.recommended, selected: false }
        })
        // dsh seeds the draft with the recommendation: every marked choice of a
        // multi-select question, or the first marked choice of a single-select one.
        const recommended = options.filter((option) => option.recommended)
        const seeded = new Set((multiple ? recommended : recommended.slice(0, 1)).map((option) => option.id))
        return {
          id: question.id,
          text: question.text,
          multiple,
          custom: '',
          skipped: false,
          options: options.map((option) => ({ ...option, selected: seeded.has(option.id) })),
        }
      })
      this.setData({ view, index: 0, error: '' })
      this.present(0)
    },

    present(index: number) {
      const view = this.data.view
      const current = view[index] ?? null
      const last = index === view.length - 1
      this.setData({
        current,
        progress: view.length > 1 ? `${index + 1} / ${view.length}` : '',
        primaryLabel: last ? '提交' : '下一题',
        primaryDisabled: current === null || !answered(current),
      })
    },

    update(index: number, next: QuestionView, moveTo = index) {
      const view = this.data.view.map((question, position) => position === index ? next : question)
      this.setData({ view, index: moveTo, error: '' })
      this.present(moveTo)
    },

    onOptionTap(event: WechatMiniprogram.TouchEvent) {
      const current = this.data.current
      if (current === null) return
      const optionId = String(event.currentTarget.dataset.oid)
      const options = current.options.map((option) => {
        if (option.id !== optionId) return current.multiple ? option : { ...option, selected: false }
        // A radio group replaces the selection; only checkboxes toggle off.
        return { ...option, selected: current.multiple ? !option.selected : true }
      })
      const chosen = current.multiple || this.data.index === this.data.view.length - 1
        ? this.data.index
        : this.data.index + 1
      this.update(this.data.index, {
        ...current,
        options,
        custom: current.multiple ? current.custom : '',
        skipped: false,
      }, chosen)
    },

    onCustom(event: WechatMiniprogram.TextareaInput) {
      const current = this.data.current
      if (current === null) return
      this.update(this.data.index, {
        ...current,
        custom: event.detail.value,
        skipped: false,
        options: current.multiple ? current.options : current.options.map((option) => ({ ...option, selected: false })),
      })
    },

    previous() {
      if (this.data.index === 0) return
      const index = this.data.index - 1
      this.setData({ index, error: '' })
      this.present(index)
    },

    next() {
      if (this.data.index >= this.data.view.length - 1) return
      const index = this.data.index + 1
      this.setData({ index, error: '' })
      this.present(index)
    },

    skip() {
      const current = this.data.current
      if (current === null) return
      const last = this.data.index === this.data.view.length - 1
      const cleared: QuestionView = {
        ...current,
        custom: '',
        skipped: true,
        options: current.options.map((option) => ({ ...option, selected: false })),
      }
      const view = this.data.view.map((question, position) => position === this.data.index ? cleared : question)
      if (!last) {
        const index = this.data.index + 1
        this.setData({ view, index, error: '' })
        this.present(index)
        return
      }
      this.setData({ view })
      this.present(this.data.index)
      this.submitView(view)
    },

    continueFlow() {
      const current = this.data.current
      if (current === null || !answered(current)) {
        this.setData({ error: '请选择一个选项或填写自定义答案。' })
        return
      }
      if (this.data.index < this.data.view.length - 1) {
        this.next()
        return
      }
      this.submitView(this.data.view)
    },

    submitView(view: QuestionView[]) {
      const request = this.properties.request as { id?: string } | null
      if (request?.id === undefined) return
      const missing = view.findIndex((question) => !answered(question) && !question.skipped)
      if (missing >= 0) {
        this.setData({ index: missing, error: '请先完成这道问题。' })
        this.present(missing)
        return
      }
      const answers = view.map((question) => {
        const custom = question.custom.trim()
        if (question.skipped) return { id: question.id, selected: [] }
        return {
          id: question.id,
          selected: custom.length === 0 || question.multiple
            ? question.options.filter((option) => option.selected).map((option) => option.id)
            : [],
          ...(custom.length === 0 ? {} : { custom }),
        }
      })
      this.triggerEvent('submit', { questionId: request.id, answers })
    },

    close() {
      this.triggerEvent('close')
    },

    noop() {
      // Keeps taps inside the card from dismissing it.
    },
  },
})

export {}
