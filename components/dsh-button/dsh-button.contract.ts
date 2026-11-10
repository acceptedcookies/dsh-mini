import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-dsh-button-height': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-dsh-button-height-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-dsh-button-background': { kind: 'color', default: 'transparent' },
    '--dsw-dsh-button-width': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-dsh-button-height-3': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-dsh-button-background-2': { kind: 'color', default: 'transparent' },
  },
} as const satisfies ComponentContract
