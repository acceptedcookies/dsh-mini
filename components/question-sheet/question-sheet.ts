interface QuestionView {
  id: string
  text: string
  multiple: boolean
  options: Array<{ id: string; label: string; detail?: string; selected: boolean }>
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    request: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },
  data: {
    view: [] as QuestionView[],
  },
  observers: {
    request(value: unknown) {
      this.build(value as { questions?: Array<{ id: string; text: string; multiple?: boolean; options: Array<{ id: string; label: string; detail?: string }> }> } | null)
    },
  },
  methods: {
    build(request: { questions?: Array<{ id: string; text: string; multiple?: boolean; options: Array<{ id: string; label: string; detail?: string }> }> } | null) {
      if (request?.questions === undefined) {
        this.setData({ view: [] })
        return
      }
      this.setData({
        view: request.questions.map((question) => ({
          id: question.id,
          text: question.text,
          multiple: question.multiple === true,
          options: question.options.map((option) => ({ ...option, selected: false })),
        })),
      })
    },
    onOptionTap(event: WechatMiniprogram.TouchEvent) {
      const questionId = String(event.currentTarget.dataset.qid)
      const optionId = String(event.currentTarget.dataset.oid)
      const view = this.data.view.map((question) => {
        if (question.id !== questionId) return question
        return {
          ...question,
          options: question.options.map((option) => {
            if (option.id !== optionId) {
              return question.multiple ? option : { ...option, selected: false }
            }
            return { ...option, selected: !option.selected }
          }),
        }
      })
      this.setData({ view })
    },
    submit() {
      const request = this.properties.request as { id?: string } | null
      if (request?.id === undefined) return
      const answers = this.data.view.map((question) => ({
        id: question.id,
        selected: question.options.filter((option) => option.selected).map((option) => option.id),
      }))
      this.triggerEvent('submit', { questionId: request.id, answers })
    },
    close() {
      this.triggerEvent('close')
    },
    noop() {
      // Prevent taps inside the sheet from closing it.
    },
  },
})
