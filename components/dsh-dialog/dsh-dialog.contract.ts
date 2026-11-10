import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-dsh-dialog-max-height': { kind: 'length', units: ['%'], default: '100%' },
    '--dsw-dsh-dialog-margin-top': { kind: 'length', units: ['px'], default: '3px' },
    '--dsw-dsh-dialog-width': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-dsh-dialog-height': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-dsh-dialog-height-2': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-dsh-dialog-min-height': { kind: 'length', units: ['px'], default: '72px' },
    '--dsw-dsh-dialog-max-height-2': { kind: 'length', units: ['px'], default: '140px' },
    '--dsw-dsh-dialog-min-width': { kind: 'length', units: ['px'], default: '64px' },
    '--dsw-dsh-dialog-height-3': { kind: 'length', units: ['px'], default: '36px' },
  },
} as const satisfies ComponentContract
