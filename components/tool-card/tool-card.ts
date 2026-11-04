const TOOL_ICONS: Record<string, string> = {
  shell: 'code-outline',
  terminal: 'code-outline',
  bash: 'code-outline',
  read: 'list-pen-outline',
  write: 'edit-outline',
  edit: 'edit-outline',
  search: 'search-outline',
  grep: 'search-outline',
  web: 'globe-outline',
  fetch: 'globe-outline',
  plan: 'plan-outline',
  task: 'checklist-outline',
}

function iconFor(tool: string): string {
  const key = tool.toLowerCase()
  return TOOL_ICONS[key] ?? 'layers-outline'
}

Component({
  properties: {
    item: { type: Object, value: {} },
    theme: { type: String, value: 'light' },
  },

  data: {
    expanded: false,
    iconName: 'layers-outline',
  },

  observers: {
    item(value: { tool?: string }) {
      this.setData({ iconName: iconFor(value.tool ?? '') })
    },
  },

  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded })
    },
  },
})
