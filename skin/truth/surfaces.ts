/** MS01 真源 · surfaces 族（15 模块键 → `--dsw-surface-*` 具名层，T-O-7 / E3） */
import type { SurfaceEntry } from './_shared'

export const SURFACE_ENTRIES: SurfaceEntry[] = [
  {
    key: 'chat-interface',
    emits: '--dsw-surface-chat-interface',
    default: 'var(--dsw-alias-bg-base)',
    points: [
      { file: 'pages/workspace/workspace.less', line: 6, use: '--dsw-alias-bg-base' },
      { file: 'pages/settings/settings.less', line: 5, use: '--dsw-alias-bg-base' },
      { file: 'app.less', line: 36, use: '--dsw-alias-bg-base' },
    ],
  },
  {
    key: 'sidebar',
    emits: '--dsw-surface-sidebar',
    default: 'var(--dsw-specific-sidebar-fill)',
    points: [{ file: 'pages/workspace/workspace.less', line: 25, use: '--dsw-specific-sidebar-fill' }],
  },
  {
    key: 'nav-bar',
    emits: '--dsw-surface-nav-bar',
    default: 'var(--dsw-alias-bg-base)',
    points: [{ file: 'pages/workspace/workspace.less', line: 406, use: '--dsw-alias-bg-base' }],
  },
  {
    key: 'chat.bubble-user',
    emits: '--dsw-surface-chat-bubble-user',
    default: 'var(--dsw-specific-bubble)',
    points: [{ file: 'components/chat-bubble/chat-bubble.less', line: 52, use: '--dsw-specific-bubble' }],
  },
  {
    key: 'chat.bubble-assistant',
    emits: '--dsw-surface-chat-bubble-assistant',
    default: 'var(--dsw-alias-bg-base)',
    points: [],
    note: 'assistant 消息无独立底（透明继承 chat-interface）；MS02 若加气泡底再登记消费点',
  },
  {
    key: 'composer',
    emits: '--dsw-surface-composer',
    default: 'var(--dsw-specific-input-major)',
    points: [{ file: 'components/composer-bar/composer-bar.less', line: 13, use: '--dsw-specific-input-major' }],
  },
  {
    key: 'right-panel',
    emits: '--dsw-surface-right-panel',
    default: 'var(--dsw-alias-bg-base)',
    points: [{ file: 'components/right-panel/right-panel.less', line: 15, use: '--dsw-alias-bg-base' }],
    note: '嵌套 card/terminal 面继续直吃 bg-layer/markdown token，不做面级改指（避免层阶塌陷）',
  },
  {
    key: 'settings',
    emits: '--dsw-surface-settings',
    default: 'var(--dsw-alias-bg-layer-2)',
    points: [{ file: 'pages/settings/settings.less', line: 41, use: '--dsw-alias-bg-layer-2' }],
    note: 'page 根（settings.less:5）归 chat-interface；遮罩（:23）归 dialog-mask',
  },
  {
    key: 'card',
    emits: '--dsw-surface-card',
    default: 'var(--dsw-alias-bg-layer-1)',
    points: [{ file: 'app.less', line: 57, use: '--dsw-alias-bg-layer-1' }],
  },
  {
    key: 'banner.notice',
    emits: '--dsw-surface-banner-notice',
    default: 'var(--dsw-alias-state-warn-tertiary)',
    points: [
      { file: 'pages/workspace/workspace.less', line: 851, use: '--dsw-alias-state-warn-tertiary' },
      { file: 'pages/workspace/workspace.less', line: 1212, use: '--dsw-alias-state-warn-tertiary' },
    ],
    note: 'hero-badge（workspace.less:651, business-tertiary）为徽标非 banner，保持 alias',
  },
  {
    key: 'menu-surface',
    emits: '--dsw-surface-menu-surface',
    default: 'var(--dsw-menu-surface-fill)',
    points: [
      { file: 'components/dsh-menu/dsh-menu.less', line: 17, use: '--dsw-menu-surface-fill' },
      { file: 'components/model-picker/model-picker.less', line: 19, use: '--dsw-menu-surface-fill' },
      { file: 'components/command-menu/command-menu.less', line: 27, use: '--dsw-menu-surface-fill' },
    ],
  },
  {
    key: 'dialog-mask',
    emits: '--dsw-surface-dialog-mask',
    default: 'var(--dsw-alias-bg-mask-1)',
    points: [
      { file: 'components/dsh-dialog/dsh-dialog.less', line: 19, use: '--dsw-alias-bg-mask-1' },
      { file: 'components/up-drawer/up-drawer.less', line: 11, use: '--dsw-alias-bg-mask-1' },
      { file: 'pages/settings/settings.less', line: 23, use: '--dsw-alias-bg-mask-1' },
    ],
  },
  {
    key: 'toast',
    emits: '--dsw-surface-toast',
    default: 'var(--dsw-alias-toast-bg)',
    points: [{ file: 'components/dsh-toast/dsh-toast.less', line: 18, use: '--dsw-alias-toast-bg' }],
  },
  {
    key: 'workspace-mask',
    emits: '--dsw-surface-workspace-mask',
    default: 'var(--dsw-alias-bg-mask-3)',
    points: [{ file: 'pages/workspace/workspace.less', line: 50, use: '--dsw-alias-bg-mask-3' }],
  },
  {
    key: 'markdown-code',
    emits: '--dsw-surface-markdown-code',
    default: 'var(--dsw-alias-markdown-code-block)',
    points: [
      { file: 'components/markdown-view/markdown-view.less', line: 19, use: '--dsw-alias-markdown-code-block' },
      { file: 'components/chat-bubble/chat-bubble.less', line: 165, use: '--dsw-alias-markdown-code-block' },
      { file: 'components/right-panel/right-panel.less', line: 259, use: '--dsw-alias-markdown-code-block' },
    ],
    note: 'code banner（markdown-code-block-banner）与 inline/tag 保持 alias——同族不同层阶',
  },
]
