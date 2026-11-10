/* GENERATED — do not edit. source: skin/truth/*.ts (MS01 build-skin.mjs) */
export interface VocabToken {
  key: string
  family: string
  domain: string
  light: string
  dark: string
  writable: boolean
  invariant: boolean
  derived: boolean
  linkedWith: string[]
}
export interface VocabSurface {
  key: string
  emits: string
  default: string
  points: Array<{ file: string; line: number; use: string }>
}
export const VOCAB = {
  schema: 'dsh-mini.skin.vocab.v1',
  tokens: {
  "--dsw-alias-bg-base": {
    "key": "--dsw-alias-bg-base",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#151517",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-menu-surface-fill"
    ]
  },
  "--dsw-alias-bg-layer-1": {
    "key": "--dsw-alias-bg-layer-1",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#232324",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-bg-layer-2": {
    "key": "--dsw-alias-bg-layer-2",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-bg-layer-3": {
    "key": "--dsw-alias-bg-layer-3",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#353436",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-label-primary": {
    "key": "--dsw-alias-label-primary",
    "family": "palette",
    "domain": "color",
    "light": "#0f1115",
    "dark": "#f9fafb",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-label-secondary": {
    "key": "--dsw-alias-label-secondary",
    "family": "palette",
    "domain": "color",
    "light": "#61666b",
    "dark": "#cfd3d6",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-label-tertiary": {
    "key": "--dsw-alias-label-tertiary",
    "family": "palette",
    "domain": "color",
    "light": "#81858c",
    "dark": "#adb2b8",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-label-caption": {
    "key": "--dsw-alias-label-caption",
    "family": "palette",
    "domain": "color",
    "light": "#adb2b8",
    "dark": "#81858c",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-bg-mask-1": {
    "key": "--dsw-alias-bg-mask-1",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.24)",
    "dark": "rgba(0, 0, 0, 0.5)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-border-l1": {
    "key": "--dsw-alias-border-l1",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.04)",
    "dark": "rgba(255, 255, 255, 0.06)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-border-l2": {
    "key": "--dsw-alias-border-l2",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.1)",
    "dark": "rgba(255, 255, 255, 0.12)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-border-l3": {
    "key": "--dsw-alias-border-l3",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.12)",
    "dark": "rgba(255, 255, 255, 0.16)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-border-l4": {
    "key": "--dsw-alias-border-l4",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.16)",
    "dark": "rgba(255, 255, 255, 0.2)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-interactive-bg-hover": {
    "key": "--dsw-alias-interactive-bg-hover",
    "family": "palette",
    "domain": "color",
    "light": "rgba(38, 49, 72, 0.06)",
    "dark": "rgba(255, 255, 255, 0.08)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-interactive-bg-active": {
    "key": "--dsw-alias-interactive-bg-active",
    "family": "palette",
    "domain": "color",
    "light": "rgba(38, 49, 72, 0.1)",
    "dark": "rgba(255, 255, 255, 0.14)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-interactive-bg-hover-solid": {
    "key": "--dsw-alias-interactive-bg-hover-solid",
    "family": "palette",
    "domain": "color",
    "light": "#f1f3f5",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-button-elevated-fill": {
    "key": "--dsw-alias-button-elevated-fill",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-button-floating-hover": {
    "key": "--dsw-alias-button-floating-hover",
    "family": "palette",
    "domain": "color",
    "light": "#f1f3f5",
    "dark": "#353436",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-brand-primary": {
    "key": "--dsw-alias-brand-primary",
    "family": "palette",
    "domain": "color",
    "light": "#0f1115",
    "dark": "#f9fafb",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-button-primary-fill": {
    "key": "--dsw-alias-button-primary-fill",
    "family": "palette",
    "domain": "color",
    "light": "#0f1115",
    "dark": "#f9fafb",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-label-primary-foreground"
    ]
  },
  "--dsw-alias-button-info-fill": {
    "key": "--dsw-alias-button-info-fill",
    "family": "palette",
    "domain": "color",
    "light": "#4176e6",
    "dark": "#7aaaff",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-hover",
      "--dsw-alias-state-business-primary",
      "--dsw-alias-label-deep-diving",
      "--dsw-alias-label-deep-diving-shimmer",
      "--dsw-alias-state-business-tertiary",
      "--dsw-alias-label-primary-bluish"
    ]
  },
  "--dsw-alias-button-info-hover": {
    "key": "--dsw-alias-button-info-hover",
    "family": "palette",
    "domain": "color",
    "light": "#7aaaff",
    "dark": "#4176e6",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-fill",
      "--dsw-alias-state-business-primary",
      "--dsw-alias-label-deep-diving",
      "--dsw-alias-label-deep-diving-shimmer",
      "--dsw-alias-state-business-tertiary",
      "--dsw-alias-label-primary-bluish"
    ]
  },
  "--dsw-alias-label-primary-foreground": {
    "key": "--dsw-alias-label-primary-foreground",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#0f1115",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-primary-fill"
    ]
  },
  "--dsw-alias-label-primary-bluish": {
    "key": "--dsw-alias-label-primary-bluish",
    "family": "palette",
    "domain": "color",
    "light": "#1d3f8f",
    "dark": "#f9fafb",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-fill",
      "--dsw-alias-button-info-hover",
      "--dsw-alias-state-business-primary",
      "--dsw-alias-label-deep-diving",
      "--dsw-alias-label-deep-diving-shimmer",
      "--dsw-alias-state-business-tertiary"
    ]
  },
  "--dsw-alias-switch-thumb": {
    "key": "--dsw-alias-switch-thumb",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#adb2b8",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-toast-bg": {
    "key": "--dsw-alias-toast-bg",
    "family": "palette",
    "domain": "color",
    "light": "#353638",
    "dark": "#43454a",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-toast-label"
    ]
  },
  "--dsw-alias-toast-label": {
    "key": "--dsw-alias-toast-label",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#ffffff",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-toast-bg"
    ]
  },
  "--dsw-menu-surface-fill": {
    "key": "--dsw-menu-surface-fill",
    "family": "palette",
    "domain": "color",
    "light": "rgba(252, 253, 254, 0.94)",
    "dark": "rgba(48, 49, 54, 0.94)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-bg-base"
    ]
  },
  "--dsw-alias-state-business-primary": {
    "key": "--dsw-alias-state-business-primary",
    "family": "palette",
    "domain": "color",
    "light": "#4176e6",
    "dark": "#7aaaff",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-fill",
      "--dsw-alias-button-info-hover",
      "--dsw-alias-label-deep-diving",
      "--dsw-alias-label-deep-diving-shimmer",
      "--dsw-alias-state-business-tertiary",
      "--dsw-alias-label-primary-bluish"
    ]
  },
  "--dsw-alias-label-deep-diving": {
    "key": "--dsw-alias-label-deep-diving",
    "family": "palette",
    "domain": "color",
    "light": "#345eba",
    "dark": "#7d9ade",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-fill",
      "--dsw-alias-button-info-hover",
      "--dsw-alias-state-business-primary",
      "--dsw-alias-label-deep-diving-shimmer",
      "--dsw-alias-state-business-tertiary",
      "--dsw-alias-label-primary-bluish"
    ]
  },
  "--dsw-alias-label-deep-diving-shimmer": {
    "key": "--dsw-alias-label-deep-diving-shimmer",
    "family": "palette",
    "domain": "color",
    "light": "#243d80",
    "dark": "#8abcfe",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-fill",
      "--dsw-alias-button-info-hover",
      "--dsw-alias-state-business-primary",
      "--dsw-alias-label-deep-diving",
      "--dsw-alias-state-business-tertiary",
      "--dsw-alias-label-primary-bluish"
    ]
  },
  "--dsw-alias-label-shimmer": {
    "key": "--dsw-alias-label-shimmer",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.3)",
    "dark": "rgba(255, 255, 255, 0.45)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-label-primary-dimmed": {
    "key": "--dsw-alias-label-primary-dimmed",
    "family": "palette",
    "domain": "color",
    "light": "#151517",
    "dark": "#ebedf2",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-state-business-tertiary": {
    "key": "--dsw-alias-state-business-tertiary",
    "family": "palette",
    "domain": "color",
    "light": "#e4edfd",
    "dark": "#343f5b",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-button-info-fill",
      "--dsw-alias-button-info-hover",
      "--dsw-alias-state-business-primary",
      "--dsw-alias-label-deep-diving",
      "--dsw-alias-label-deep-diving-shimmer",
      "--dsw-alias-label-primary-bluish"
    ]
  },
  "--dsw-alias-state-error-primary": {
    "key": "--dsw-alias-state-error-primary",
    "family": "palette",
    "domain": "color",
    "light": "#ec1313",
    "dark": "#f25a5a",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-code-diff-deleted"
    ]
  },
  "--dsw-alias-state-warn-primary": {
    "key": "--dsw-alias-state-warn-primary",
    "family": "palette",
    "domain": "color",
    "light": "#f59e0b",
    "dark": "#f59e0b",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-state-warn-secondary": {
    "key": "--dsw-alias-state-warn-secondary",
    "family": "palette",
    "domain": "color",
    "light": "#f7ad31",
    "dark": "#f7ad31",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-state-warn-tertiary": {
    "key": "--dsw-alias-state-warn-tertiary",
    "family": "palette",
    "domain": "color",
    "light": "#fef5e7",
    "dark": "#2a241a",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-state-warn-label"
    ]
  },
  "--dsw-alias-state-warn-label": {
    "key": "--dsw-alias-state-warn-label",
    "family": "palette",
    "domain": "color",
    "light": "#dd8629",
    "dark": "#dd8629",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-state-warn-tertiary"
    ]
  },
  "--dsw-alias-state-success-primary": {
    "key": "--dsw-alias-state-success-primary",
    "family": "palette",
    "domain": "color",
    "light": "#22c55e",
    "dark": "#22c55e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-code-diff-added"
    ]
  },
  "--dsw-alias-state-success-tertiary": {
    "key": "--dsw-alias-state-success-tertiary",
    "family": "palette",
    "domain": "color",
    "light": "#e6faed",
    "dark": "#e6faed",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-code-diff-added": {
    "key": "--dsw-alias-code-diff-added",
    "family": "palette",
    "domain": "color",
    "light": "rgb(34 197 94 / 8%)",
    "dark": "rgb(34 197 94 / 12%)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-state-success-primary"
    ]
  },
  "--dsw-alias-code-diff-deleted": {
    "key": "--dsw-alias-code-diff-deleted",
    "family": "palette",
    "domain": "color",
    "light": "rgb(236 19 19 / 8%)",
    "dark": "rgb(242 90 90 / 12%)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-state-error-primary"
    ]
  },
  "--dsw-alias-button-ghost-active-fill": {
    "key": "--dsw-alias-button-ghost-active-fill",
    "family": "palette",
    "domain": "color",
    "light": "#ebedf0",
    "dark": "#43454a",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-markdown-code-block": {
    "key": "--dsw-alias-markdown-code-block",
    "family": "palette",
    "domain": "color",
    "light": "#f9fafb",
    "dark": "#1b1b1c",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-markdown-code-block-banner",
      "--dsw-alias-markdown-inline-code"
    ]
  },
  "--dsw-alias-markdown-code-block-banner": {
    "key": "--dsw-alias-markdown-code-block-banner",
    "family": "palette",
    "domain": "color",
    "light": "#f9fafb",
    "dark": "#232324",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-markdown-code-block",
      "--dsw-alias-markdown-inline-code"
    ]
  },
  "--dsw-alias-markdown-inline-code": {
    "key": "--dsw-alias-markdown-inline-code",
    "family": "palette",
    "domain": "color",
    "light": "#fafafa",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-alias-markdown-code-block",
      "--dsw-alias-markdown-code-block-banner"
    ]
  },
  "--dsw-alias-markdown-tag": {
    "key": "--dsw-alias-markdown-tag",
    "family": "palette",
    "domain": "color",
    "light": "#f1f3f5",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-specific-bubble": {
    "key": "--dsw-specific-bubble",
    "family": "palette",
    "domain": "color",
    "light": "#edf3fe",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-specific-input-major": {
    "key": "--dsw-specific-input-major",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#2c2c2e",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-specific-selector": {
    "key": "--dsw-specific-selector",
    "family": "palette",
    "domain": "color",
    "light": "#f9fafb",
    "dark": "#353436",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-specific-sidebar-fill": {
    "key": "--dsw-specific-sidebar-fill",
    "family": "palette",
    "domain": "color",
    "light": "#f9fafb",
    "dark": "#1b1b1c",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-sidebar-list-fade"
    ]
  },
  "--dsw-specific-sidebar-nav-item-active": {
    "key": "--dsw-specific-sidebar-nav-item-active",
    "family": "palette",
    "domain": "color",
    "light": "#ebedf0",
    "dark": "#353436",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-sidebar-list-fade": {
    "key": "--dsw-sidebar-list-fade",
    "family": "palette",
    "domain": "background-shorthand",
    "light": "linear-gradient(to bottom, rgba(249, 250, 251, 0), #f9fafb)",
    "dark": "linear-gradient(to bottom, rgba(27, 27, 28, 0), #1b1b1c)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": [
      "--dsw-specific-sidebar-fill"
    ]
  },
  "--dsw-alias-traj-span-context": {
    "key": "--dsw-alias-traj-span-context",
    "family": "palette",
    "domain": "color",
    "light": "#4ea96e",
    "dark": "#4ea96e",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-span-message": {
    "key": "--dsw-alias-traj-span-message",
    "family": "palette",
    "domain": "color",
    "light": "#6b73d8",
    "dark": "#6b73d8",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-kind-context": {
    "key": "--dsw-alias-traj-kind-context",
    "family": "palette",
    "domain": "color",
    "light": "#3f9d63",
    "dark": "#3f9d63",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-kind-context-bg": {
    "key": "--dsw-alias-traj-kind-context-bg",
    "family": "palette",
    "domain": "color",
    "light": "rgba(34, 197, 94, 0.12)",
    "dark": "rgba(34, 197, 94, 0.12)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-kind-message": {
    "key": "--dsw-alias-traj-kind-message",
    "family": "palette",
    "domain": "color",
    "light": "#4b63c9",
    "dark": "#4b63c9",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-kind-message-bg": {
    "key": "--dsw-alias-traj-kind-message-bg",
    "family": "palette",
    "domain": "color",
    "light": "rgba(101, 120, 220, 0.13)",
    "dark": "rgba(101, 120, 220, 0.13)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-kind-subtool": {
    "key": "--dsw-alias-traj-kind-subtool",
    "family": "palette",
    "domain": "color",
    "light": "#a8783a",
    "dark": "#a8783a",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-traj-kind-subtool-bg": {
    "key": "--dsw-alias-traj-kind-subtool-bg",
    "family": "palette",
    "domain": "color",
    "light": "rgba(247, 173, 49, 0.12)",
    "dark": "rgba(247, 173, 49, 0.12)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-state-warn-wash": {
    "key": "--dsw-alias-state-warn-wash",
    "family": "palette",
    "domain": "color",
    "light": "rgba(245, 158, 11, 0.1)",
    "dark": "rgba(245, 158, 11, 0.1)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-state-error-wash": {
    "key": "--dsw-alias-state-error-wash",
    "family": "palette",
    "domain": "color",
    "light": "rgba(236, 19, 19, 0.08)",
    "dark": "rgba(236, 19, 19, 0.08)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-scrim-strong": {
    "key": "--dsw-alias-scrim-strong",
    "family": "palette",
    "domain": "color",
    "light": "rgba(15, 17, 21, 0.7)",
    "dark": "rgba(15, 17, 21, 0.7)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-label-on-dark": {
    "key": "--dsw-alias-label-on-dark",
    "family": "palette",
    "domain": "color",
    "light": "#ffffff",
    "dark": "#ffffff",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-spinner-track": {
    "key": "--dsw-alias-spinner-track",
    "family": "palette",
    "domain": "color",
    "light": "rgba(255, 255, 255, 0.35)",
    "dark": "rgba(255, 255, 255, 0.35)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-accent-inset": {
    "key": "--dsw-alias-accent-inset",
    "family": "palette",
    "domain": "color",
    "light": "rgba(65, 118, 230, 0.22)",
    "dark": "rgba(65, 118, 230, 0.22)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-bg-mask-3": {
    "key": "--dsw-alias-bg-mask-3",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0, 0, 0, 0.48)",
    "dark": "rgba(0, 0, 0, 0.56)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-markdown-code-text": {
    "key": "--dsw-alias-markdown-code-text",
    "family": "palette",
    "domain": "color",
    "light": "#0f1115",
    "dark": "#e6e6e6",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-markdown-tertiary": {
    "key": "--dsw-alias-markdown-tertiary",
    "family": "palette",
    "domain": "color",
    "light": "#81858c",
    "dark": "#81858c",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-alias-markdown-table-row-alt": {
    "key": "--dsw-alias-markdown-table-row-alt",
    "family": "palette",
    "domain": "color",
    "light": "rgba(0,0,0,0.02)",
    "dark": "rgba(255,255,255,0.03)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-xs": {
    "key": "--dsw-radius-xs",
    "family": "shape",
    "domain": "length",
    "light": "4px",
    "dark": "4px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-sm": {
    "key": "--dsw-radius-sm",
    "family": "shape",
    "domain": "length",
    "light": "8px",
    "dark": "8px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-md": {
    "key": "--dsw-radius-md",
    "family": "shape",
    "domain": "length",
    "light": "12px",
    "dark": "12px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-lg": {
    "key": "--dsw-radius-lg",
    "family": "shape",
    "domain": "length",
    "light": "16px",
    "dark": "16px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-xl": {
    "key": "--dsw-radius-xl",
    "family": "shape",
    "domain": "length",
    "light": "20px",
    "dark": "20px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-panel": {
    "key": "--dsw-radius-panel",
    "family": "shape",
    "domain": "length",
    "light": "28px",
    "dark": "28px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-micro": {
    "key": "--dsw-radius-micro",
    "family": "shape",
    "domain": "length",
    "light": "1px",
    "dark": "1px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-hairline": {
    "key": "--dsw-radius-hairline",
    "family": "shape",
    "domain": "length",
    "light": "2px",
    "dark": "2px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-xxs": {
    "key": "--dsw-radius-xxs",
    "family": "shape",
    "domain": "length",
    "light": "3px",
    "dark": "3px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-pill": {
    "key": "--dsw-radius-pill",
    "family": "shape",
    "domain": "length",
    "light": "999px",
    "dark": "999px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-radius-circle": {
    "key": "--dsw-radius-circle",
    "family": "shape",
    "domain": "length",
    "light": "50%",
    "dark": "50%",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-2": {
    "key": "--dsw-space-2",
    "family": "spacing",
    "domain": "length",
    "light": "2px",
    "dark": "2px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-4": {
    "key": "--dsw-space-4",
    "family": "spacing",
    "domain": "length",
    "light": "4px",
    "dark": "4px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-6": {
    "key": "--dsw-space-6",
    "family": "spacing",
    "domain": "length",
    "light": "6px",
    "dark": "6px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-8": {
    "key": "--dsw-space-8",
    "family": "spacing",
    "domain": "length",
    "light": "8px",
    "dark": "8px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-10": {
    "key": "--dsw-space-10",
    "family": "spacing",
    "domain": "length",
    "light": "10px",
    "dark": "10px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-12": {
    "key": "--dsw-space-12",
    "family": "spacing",
    "domain": "length",
    "light": "12px",
    "dark": "12px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-14": {
    "key": "--dsw-space-14",
    "family": "spacing",
    "domain": "length",
    "light": "14px",
    "dark": "14px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-16": {
    "key": "--dsw-space-16",
    "family": "spacing",
    "domain": "length",
    "light": "16px",
    "dark": "16px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-20": {
    "key": "--dsw-space-20",
    "family": "spacing",
    "domain": "length",
    "light": "20px",
    "dark": "20px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-24": {
    "key": "--dsw-space-24",
    "family": "spacing",
    "domain": "length",
    "light": "24px",
    "dark": "24px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-space-32": {
    "key": "--dsw-space-32",
    "family": "spacing",
    "domain": "length",
    "light": "32px",
    "dark": "32px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-page-x": {
    "key": "--dsw-page-x",
    "family": "spacing",
    "domain": "length",
    "light": "var(--dsw-space-16)",
    "dark": "var(--dsw-space-16)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-content-x": {
    "key": "--dsw-content-x",
    "family": "spacing",
    "domain": "length",
    "light": "var(--dsw-space-32)",
    "dark": "var(--dsw-space-32)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-panel-x": {
    "key": "--dsw-panel-x",
    "family": "spacing",
    "domain": "length",
    "light": "var(--dsw-space-24)",
    "dark": "var(--dsw-space-24)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-inset-x": {
    "key": "--dsw-inset-x",
    "family": "spacing",
    "domain": "length",
    "light": "var(--dsw-space-12)",
    "dark": "var(--dsw-space-12)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-compact-x": {
    "key": "--dsw-compact-x",
    "family": "spacing",
    "domain": "length",
    "light": "var(--dsw-space-8)",
    "dark": "var(--dsw-space-8)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-font-family": {
    "key": "--dsw-font-family",
    "family": "typography",
    "domain": "family-string",
    "light": "-apple-system, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", sans-serif",
    "dark": "-apple-system, BlinkMacSystemFont, \"Helvetica Neue\", \"PingFang SC\", sans-serif",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--ds-font-family-code": {
    "key": "--ds-font-family-code",
    "family": "typography",
    "domain": "family-string",
    "light": "Menlo, \"SFMono-Regular\", Consolas, monospace",
    "dark": "Menlo, \"SFMono-Regular\", Consolas, monospace",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-display": {
    "key": "--dsw-text-display",
    "family": "typography",
    "domain": "length",
    "light": "26px",
    "dark": "26px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-section": {
    "key": "--dsw-text-section",
    "family": "typography",
    "domain": "length",
    "light": "20px",
    "dark": "20px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-title": {
    "key": "--dsw-text-title",
    "family": "typography",
    "domain": "length",
    "light": "18px",
    "dark": "18px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-headline": {
    "key": "--dsw-text-headline",
    "family": "typography",
    "domain": "length",
    "light": "16px",
    "dark": "16px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-subtitle": {
    "key": "--dsw-text-subtitle",
    "family": "typography",
    "domain": "length",
    "light": "15px",
    "dark": "15px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-body": {
    "key": "--dsw-text-body",
    "family": "typography",
    "domain": "length",
    "light": "14px",
    "dark": "14px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-label": {
    "key": "--dsw-text-label",
    "family": "typography",
    "domain": "length",
    "light": "13px",
    "dark": "13px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-caption": {
    "key": "--dsw-text-caption",
    "family": "typography",
    "domain": "length",
    "light": "12px",
    "dark": "12px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-micro": {
    "key": "--dsw-text-micro",
    "family": "typography",
    "domain": "length",
    "light": "11px",
    "dark": "11px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-mini": {
    "key": "--dsw-text-mini",
    "family": "typography",
    "domain": "length",
    "light": "10px",
    "dark": "10px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-badge": {
    "key": "--dsw-text-badge",
    "family": "typography",
    "domain": "length",
    "light": "9px",
    "dark": "9px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-text-atom": {
    "key": "--dsw-text-atom",
    "family": "typography",
    "domain": "length",
    "light": "7px",
    "dark": "7px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-14": {
    "key": "--dsw-lh-14",
    "family": "typography",
    "domain": "length",
    "light": "14px",
    "dark": "14px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-15": {
    "key": "--dsw-lh-15",
    "family": "typography",
    "domain": "length",
    "light": "15px",
    "dark": "15px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-16": {
    "key": "--dsw-lh-16",
    "family": "typography",
    "domain": "length",
    "light": "16px",
    "dark": "16px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-18": {
    "key": "--dsw-lh-18",
    "family": "typography",
    "domain": "length",
    "light": "18px",
    "dark": "18px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-19": {
    "key": "--dsw-lh-19",
    "family": "typography",
    "domain": "length",
    "light": "19px",
    "dark": "19px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-20": {
    "key": "--dsw-lh-20",
    "family": "typography",
    "domain": "length",
    "light": "20px",
    "dark": "20px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-21": {
    "key": "--dsw-lh-21",
    "family": "typography",
    "domain": "length",
    "light": "21px",
    "dark": "21px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-22": {
    "key": "--dsw-lh-22",
    "family": "typography",
    "domain": "length",
    "light": "22px",
    "dark": "22px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-24": {
    "key": "--dsw-lh-24",
    "family": "typography",
    "domain": "length",
    "light": "24px",
    "dark": "24px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-28": {
    "key": "--dsw-lh-28",
    "family": "typography",
    "domain": "length",
    "light": "28px",
    "dark": "28px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-32": {
    "key": "--dsw-lh-32",
    "family": "typography",
    "domain": "length",
    "light": "32px",
    "dark": "32px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-36": {
    "key": "--dsw-lh-36",
    "family": "typography",
    "domain": "length",
    "light": "36px",
    "dark": "36px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-lh-38": {
    "key": "--dsw-lh-38",
    "family": "typography",
    "domain": "length",
    "light": "38px",
    "dark": "38px",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-tracking-wide": {
    "key": "--dsw-tracking-wide",
    "family": "typography",
    "domain": "length",
    "light": "0.035em",
    "dark": "0.035em",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-tracking-wider": {
    "key": "--dsw-tracking-wider",
    "family": "typography",
    "domain": "length",
    "light": "0.04em",
    "dark": "0.04em",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-weight-regular": {
    "key": "--dsw-weight-regular",
    "family": "typography",
    "domain": "font-weight",
    "light": "400",
    "dark": "400",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-weight-medium": {
    "key": "--dsw-weight-medium",
    "family": "typography",
    "domain": "font-weight",
    "light": "500",
    "dark": "500",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-weight-semibold": {
    "key": "--dsw-weight-semibold",
    "family": "typography",
    "domain": "font-weight",
    "light": "600",
    "dark": "600",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-weight-demi": {
    "key": "--dsw-weight-demi",
    "family": "typography",
    "domain": "font-weight",
    "light": "650",
    "dark": "650",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-elevation-prominent": {
    "key": "--dsw-elevation-prominent",
    "family": "elevation",
    "domain": "shadow",
    "light": "0 8px 32px rgba(15, 17, 21, 0.16), 0 1px 2px rgba(15, 17, 21, 0.08)",
    "dark": "0 8px 32px rgba(0, 0, 0, 0.48), 0 1px 2px rgba(0, 0, 0, 0.3)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-elevation-soft": {
    "key": "--dsw-elevation-soft",
    "family": "elevation",
    "domain": "shadow",
    "light": "0 1px 2px rgba(15, 17, 21, 0.04), 0 4px 16px rgba(15, 17, 21, 0.04)",
    "dark": "0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-elevation-sidebar": {
    "key": "--dsw-elevation-sidebar",
    "family": "elevation",
    "domain": "shadow",
    "light": "12px 0 40px rgba(0, 0, 0, 0.16)",
    "dark": "12px 0 40px rgba(0, 0, 0, 0.16)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-elevation-drawer": {
    "key": "--dsw-elevation-drawer",
    "family": "elevation",
    "domain": "shadow",
    "light": "-12px 0 40px rgba(0, 0, 0, 0.14)",
    "dark": "-12px 0 40px rgba(0, 0, 0, 0.14)",
    "writable": false,
    "invariant": true,
    "derived": false,
    "linkedWith": []
  },
  "--dsw-blur-surface": {
    "key": "--dsw-blur-surface",
    "family": "effects",
    "domain": "filter",
    "light": "blur(20px)",
    "dark": "blur(20px)",
    "writable": true,
    "invariant": false,
    "derived": false,
    "linkedWith": []
  }
} as Record<string, VocabToken>,
  surfaces: {
  "chat-interface": {
    "key": "chat-interface",
    "emits": "--dsw-surface-chat-interface",
    "default": "var(--dsw-alias-bg-base)",
    "points": [
      {
        "file": "pages/workspace/workspace.less",
        "line": 6,
        "use": "--dsw-alias-bg-base"
      },
      {
        "file": "pages/settings/settings.less",
        "line": 5,
        "use": "--dsw-alias-bg-base"
      },
      {
        "file": "app.less",
        "line": 36,
        "use": "--dsw-alias-bg-base"
      }
    ]
  },
  "sidebar": {
    "key": "sidebar",
    "emits": "--dsw-surface-sidebar",
    "default": "var(--dsw-specific-sidebar-fill)",
    "points": [
      {
        "file": "pages/workspace/workspace.less",
        "line": 25,
        "use": "--dsw-specific-sidebar-fill"
      }
    ]
  },
  "nav-bar": {
    "key": "nav-bar",
    "emits": "--dsw-surface-nav-bar",
    "default": "var(--dsw-alias-bg-base)",
    "points": [
      {
        "file": "pages/workspace/workspace.less",
        "line": 406,
        "use": "--dsw-alias-bg-base"
      }
    ]
  },
  "chat.bubble-user": {
    "key": "chat.bubble-user",
    "emits": "--dsw-surface-chat-bubble-user",
    "default": "var(--dsw-specific-bubble)",
    "points": [
      {
        "file": "components/chat-bubble/chat-bubble.less",
        "line": 52,
        "use": "--dsw-specific-bubble"
      }
    ]
  },
  "chat.bubble-assistant": {
    "key": "chat.bubble-assistant",
    "emits": "--dsw-surface-chat-bubble-assistant",
    "default": "var(--dsw-alias-bg-base)",
    "points": []
  },
  "composer": {
    "key": "composer",
    "emits": "--dsw-surface-composer",
    "default": "var(--dsw-specific-input-major)",
    "points": [
      {
        "file": "components/composer-bar/composer-bar.less",
        "line": 13,
        "use": "--dsw-specific-input-major"
      }
    ]
  },
  "right-panel": {
    "key": "right-panel",
    "emits": "--dsw-surface-right-panel",
    "default": "var(--dsw-alias-bg-base)",
    "points": [
      {
        "file": "components/right-panel/right-panel.less",
        "line": 15,
        "use": "--dsw-alias-bg-base"
      }
    ]
  },
  "settings": {
    "key": "settings",
    "emits": "--dsw-surface-settings",
    "default": "var(--dsw-alias-bg-layer-2)",
    "points": [
      {
        "file": "pages/settings/settings.less",
        "line": 41,
        "use": "--dsw-alias-bg-layer-2"
      }
    ]
  },
  "card": {
    "key": "card",
    "emits": "--dsw-surface-card",
    "default": "var(--dsw-alias-bg-layer-1)",
    "points": [
      {
        "file": "app.less",
        "line": 57,
        "use": "--dsw-alias-bg-layer-1"
      }
    ]
  },
  "banner.notice": {
    "key": "banner.notice",
    "emits": "--dsw-surface-banner-notice",
    "default": "var(--dsw-alias-state-warn-tertiary)",
    "points": [
      {
        "file": "pages/workspace/workspace.less",
        "line": 851,
        "use": "--dsw-alias-state-warn-tertiary"
      },
      {
        "file": "pages/workspace/workspace.less",
        "line": 1212,
        "use": "--dsw-alias-state-warn-tertiary"
      }
    ]
  },
  "menu-surface": {
    "key": "menu-surface",
    "emits": "--dsw-surface-menu-surface",
    "default": "var(--dsw-menu-surface-fill)",
    "points": [
      {
        "file": "components/dsh-menu/dsh-menu.less",
        "line": 17,
        "use": "--dsw-menu-surface-fill"
      },
      {
        "file": "components/model-picker/model-picker.less",
        "line": 19,
        "use": "--dsw-menu-surface-fill"
      },
      {
        "file": "components/command-menu/command-menu.less",
        "line": 27,
        "use": "--dsw-menu-surface-fill"
      }
    ]
  },
  "dialog-mask": {
    "key": "dialog-mask",
    "emits": "--dsw-surface-dialog-mask",
    "default": "var(--dsw-alias-bg-mask-1)",
    "points": [
      {
        "file": "components/dsh-dialog/dsh-dialog.less",
        "line": 19,
        "use": "--dsw-alias-bg-mask-1"
      },
      {
        "file": "components/up-drawer/up-drawer.less",
        "line": 11,
        "use": "--dsw-alias-bg-mask-1"
      },
      {
        "file": "pages/settings/settings.less",
        "line": 23,
        "use": "--dsw-alias-bg-mask-1"
      }
    ]
  },
  "toast": {
    "key": "toast",
    "emits": "--dsw-surface-toast",
    "default": "var(--dsw-alias-toast-bg)",
    "points": [
      {
        "file": "components/dsh-toast/dsh-toast.less",
        "line": 18,
        "use": "--dsw-alias-toast-bg"
      }
    ]
  },
  "workspace-mask": {
    "key": "workspace-mask",
    "emits": "--dsw-surface-workspace-mask",
    "default": "var(--dsw-alias-bg-mask-3)",
    "points": [
      {
        "file": "pages/workspace/workspace.less",
        "line": 50,
        "use": "--dsw-alias-bg-mask-3"
      }
    ]
  },
  "markdown-code": {
    "key": "markdown-code",
    "emits": "--dsw-surface-markdown-code",
    "default": "var(--dsw-alias-markdown-code-block)",
    "points": [
      {
        "file": "components/markdown-view/markdown-view.less",
        "line": 19,
        "use": "--dsw-alias-markdown-code-block"
      },
      {
        "file": "components/chat-bubble/chat-bubble.less",
        "line": 165,
        "use": "--dsw-alias-markdown-code-block"
      },
      {
        "file": "components/right-panel/right-panel.less",
        "line": 259,
        "use": "--dsw-alias-markdown-code-block"
      }
    ]
  }
} as Record<string, VocabSurface>,
  sounds: ["message.send","message.receive","turn.complete","turn.error","composer.attach","session.new","session.delete","ui.tap"],
  assets: ["brand.fish","hero.loop","running.whale","icon.*"],
  chrome: {
  "navBackground": {
    "light": "#ffffff",
    "dark": "#151517"
  },
  "navFront": {
    "light": "#000000",
    "dark": "#ffffff"
  },
  "pullBackground": {
    "light": "#f7f7f8",
    "dark": "#151517"
  }
} as Record<string, { light: string; dark: string }>,
  components: {
  "approval-sheet": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-approval-sheet-max-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "760px"
      },
      "--dsw-approval-sheet-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "6px"
      },
      "--dsw-approval-sheet-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "6px"
      },
      "--dsw-approval-sheet-max-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "336px"
      },
      "--dsw-approval-sheet-min-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "88px"
      },
      "--dsw-approval-sheet-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      }
    }
  },
  "chat-bubble": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-chat-bubble-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-chat-bubble-margin-top-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "8px"
      },
      "--dsw-chat-bubble-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "240px"
      },
      "--dsw-chat-bubble-max-width": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "100%"
      },
      "--dsw-chat-bubble-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "64px"
      },
      "--dsw-chat-bubble-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-chat-bubble-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-chat-bubble-width-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "160px"
      },
      "--dsw-chat-bubble-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "160px"
      },
      "--dsw-chat-bubble-margin-bottom": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "6px"
      },
      "--dsw-chat-bubble-min-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "18px"
      },
      "--dsw-chat-bubble-width-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "10px"
      },
      "--dsw-chat-bubble-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "10px"
      },
      "--dsw-chat-bubble-margin-top-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "5px"
      },
      "--dsw-chat-bubble-max-width-2": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "82%"
      }
    }
  },
  "command-menu": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-command-menu-background": {
        "kind": "color",
        "default": "transparent"
      },
      "--dsw-command-menu-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "23px"
      },
      "--dsw-command-menu-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "3px"
      },
      "--dsw-command-menu-min-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      },
      "--dsw-command-menu-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "14px"
      },
      "--dsw-command-menu-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "14px"
      },
      "--dsw-command-menu-max-width": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "40%"
      },
      "--dsw-command-menu-max-width-2": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "20%"
      }
    }
  },
  "composer-bar": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-composer-bar-padding-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "8px"
      },
      "--dsw-composer-bar-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "56px"
      },
      "--dsw-composer-bar-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "56px"
      },
      "--dsw-composer-bar-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "-6px"
      },
      "--dsw-composer-bar-right": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "-6px"
      },
      "--dsw-composer-bar-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "18px"
      },
      "--dsw-composer-bar-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "18px"
      },
      "--dsw-composer-bar-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-composer-bar-max-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "240px"
      },
      "--dsw-composer-bar-min-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "52px"
      },
      "--dsw-composer-bar-width-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-composer-bar-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-composer-bar-max-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "220px"
      },
      "--dsw-composer-bar-height-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-composer-bar-max-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "220px"
      },
      "--dsw-composer-bar-height-5": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-composer-bar-width-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      },
      "--dsw-composer-bar-height-6": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      },
      "--dsw-composer-bar-width-5": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "14px"
      },
      "--dsw-composer-bar-height-7": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "14px"
      }
    }
  },
  "dsh-button": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-dsh-button-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-dsh-button-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-dsh-button-background": {
        "kind": "color",
        "default": "transparent"
      },
      "--dsw-dsh-button-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-dsh-button-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-dsh-button-background-2": {
        "kind": "color",
        "default": "transparent"
      }
    }
  },
  "dsh-dialog": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-dsh-dialog-max-height": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "100%"
      },
      "--dsw-dsh-dialog-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "3px"
      },
      "--dsw-dsh-dialog-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-dsh-dialog-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-dsh-dialog-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-dsh-dialog-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "72px"
      },
      "--dsw-dsh-dialog-max-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "140px"
      },
      "--dsw-dsh-dialog-min-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "64px"
      },
      "--dsw-dsh-dialog-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      }
    }
  },
  "dsh-icon": {
    "contractVersion": "1.0.0"
  },
  "dsh-menu": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-dsh-menu-max-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "320px"
      },
      "--dsw-dsh-menu-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      },
      "--dsw-dsh-menu-gap": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "1px"
      },
      "--dsw-dsh-menu-gap-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "5px"
      }
    }
  },
  "dsh-switch": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-dsh-switch-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-dsh-switch-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-dsh-switch-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      },
      "--dsw-dsh-switch-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      }
    }
  },
  "dsh-tabs": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-dsh-tabs-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      },
      "--dsw-dsh-tabs-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      },
      "--dsw-dsh-tabs-bottom": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "-1px"
      },
      "--dsw-dsh-tabs-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-dsh-tabs-height-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      },
      "--dsw-dsh-tabs-margin-right": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "1px"
      },
      "--dsw-dsh-tabs-height-5": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      },
      "--dsw-dsh-tabs-right": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "9px"
      },
      "--dsw-dsh-tabs-left": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "9px"
      },
      "--dsw-dsh-tabs-height-6": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-dsh-tabs-height-7": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-dsh-tabs-height-8": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-dsh-tabs-bottom-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "-0.5px"
      },
      "--dsw-dsh-tabs-height-9": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-dsh-tabs-height-10": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-dsh-tabs-min-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "64px"
      },
      "--dsw-dsh-tabs-max-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "140px"
      }
    }
  },
  "dsh-toast": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-dsh-toast-left": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "50%"
      }
    }
  },
  "error-center": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-error-center-left": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "50%"
      },
      "--dsw-error-center-min-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "220px"
      },
      "--dsw-error-center-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "1px"
      },
      "--dsw-error-center-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-error-center-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-error-center-max-height": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "100%"
      },
      "--dsw-error-center-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-error-center-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-error-center-max-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "160px"
      },
      "--dsw-error-center-max-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "240px"
      },
      "--dsw-error-center-width-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "76px"
      }
    }
  },
  "feedback-dialog": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-feedback-dialog-max-height": {
        "kind": "length",
        "units": [
          "%"
        ],
        "default": "100%"
      },
      "--dsw-feedback-dialog-padding-bottom": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-feedback-dialog-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-feedback-dialog-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-feedback-dialog-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-feedback-dialog-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-feedback-dialog-background": {
        "kind": "color",
        "default": "transparent"
      },
      "--dsw-feedback-dialog-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "116px"
      },
      "--dsw-feedback-dialog-max-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "280px"
      },
      "--dsw-feedback-dialog-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "44px"
      }
    }
  },
  "goal-bar": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-goal-bar-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-goal-bar-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-goal-bar-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-goal-bar-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-goal-bar-min-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-goal-bar-max-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "96px"
      }
    }
  },
  "markdown-view": {
    "contractVersion": "1.0.0"
  },
  "message-actions": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-message-actions-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-message-actions-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-message-actions-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      }
    }
  },
  "model-picker": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-model-picker-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "260px"
      },
      "--dsw-model-picker-max-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "360px"
      },
      "--dsw-model-picker-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "34px"
      }
    }
  },
  "question-sheet": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-question-sheet-max-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "760px"
      },
      "--dsw-question-sheet-max-height": {
        "kind": "length",
        "units": [
          "vh"
        ],
        "default": "60vh"
      },
      "--dsw-question-sheet-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-question-sheet-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-question-sheet-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "40px"
      },
      "--dsw-question-sheet-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-question-sheet-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-question-sheet-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-question-sheet-width-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "14px"
      },
      "--dsw-question-sheet-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "14px"
      },
      "--dsw-question-sheet-min-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-question-sheet-max-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "96px"
      },
      "--dsw-question-sheet-width-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-question-sheet-height-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-question-sheet-min-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "64px"
      },
      "--dsw-question-sheet-height-5": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      }
    }
  },
  "reasoning-row": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-reasoning-row-margin-bottom": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      },
      "--dsw-reasoning-row-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-reasoning-row-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      },
      "--dsw-reasoning-row-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      },
      "--dsw-reasoning-row-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-reasoning-row-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-reasoning-row-color": {
        "kind": "color",
        "default": "transparent"
      },
      "--dsw-reasoning-row--webkit-text-fill-color": {
        "kind": "color",
        "default": "transparent"
      }
    }
  },
  "right-panel": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-right-panel-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "380px"
      },
      "--dsw-right-panel-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "38px"
      },
      "--dsw-right-panel-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-right-panel-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "28px"
      },
      "--dsw-right-panel-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "36px"
      },
      "--dsw-right-panel-min-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "52px"
      },
      "--dsw-right-panel-width-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      },
      "--dsw-right-panel-height-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      },
      "--dsw-right-panel-min-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "52px"
      },
      "--dsw-right-panel-width-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      },
      "--dsw-right-panel-height-5": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "32px"
      },
      "--dsw-right-panel-margin-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "8px"
      },
      "--dsw-right-panel-height-6": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "40px"
      },
      "--dsw-right-panel-height-7": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "40px"
      },
      "--dsw-right-panel-max-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "260px"
      },
      "--dsw-right-panel-width-5": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "6px"
      },
      "--dsw-right-panel-height-8": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "6px"
      },
      "--dsw-right-panel-margin-top-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "7px"
      },
      "--dsw-right-panel-min-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "20px"
      },
      "--dsw-right-panel-min-height-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "40px"
      }
    }
  },
  "tool-card": {
    "contractVersion": "1.0.0",
    "vars": {
      "--dsw-tool-card-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "24px"
      },
      "--dsw-tool-card-left": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "22px"
      },
      "--dsw-tool-card--webkit-text-fill-color": {
        "kind": "color",
        "default": "transparent"
      },
      "--dsw-tool-card-width": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      },
      "--dsw-tool-card-height-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "16px"
      },
      "--dsw-tool-card-width-2": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-tool-card-height-3": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "2px"
      },
      "--dsw-tool-card-max-height": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "150px"
      },
      "--dsw-tool-card-height-4": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "0.5px"
      }
    }
  },
  "trajectory-view": {
    "contractVersion": "1.0.0"
  },
  "up-drawer": {
    "contractVersion": "1.0.0",
    "layout": [
      "dock-bottom"
    ],
    "vars": {
      "--dsw-upd-height": {
        "kind": "length",
        "units": [
          "vh"
        ],
        "default": "33.333vh"
      },
      "--dsw-upd-close-top": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "-44px"
      },
      "--dsw-upd-close-size": {
        "kind": "length",
        "units": [
          "px"
        ],
        "default": "30px"
      }
    },
    "options": {},
    "assets": {}
  }
} as Record<string, unknown>,
  contractGlob: "components/*/*.contract.ts",
  derivedKeys: ["--bg","--bg-elevated","--bg-muted","--text","--text-secondary","--text-tertiary","--border","--accent","--accent-soft","--danger","--success","--warn","--user-bubble","--user-text","--assistant-bubble","--shadow","--radius"],
} as const

export const VOCAB_TOKENS = VOCAB.tokens
export type Vocab = typeof VOCAB
