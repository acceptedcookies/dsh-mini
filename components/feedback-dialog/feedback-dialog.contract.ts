import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-feedback-dialog-max-height': { kind: 'length', units: ['%'], default: '100%' },
    '--dsw-feedback-dialog-padding-bottom': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-feedback-dialog-width': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-feedback-dialog-height': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-feedback-dialog-margin-top': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-feedback-dialog-height-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-feedback-dialog-background': { kind: 'color', default: 'transparent' },
    '--dsw-feedback-dialog-min-height': { kind: 'length', units: ['px'], default: '116px' },
    '--dsw-feedback-dialog-max-height-2': { kind: 'length', units: ['px'], default: '280px' },
    '--dsw-feedback-dialog-height-3': { kind: 'length', units: ['px'], default: '44px' },
  },
} as const satisfies ComponentContract
