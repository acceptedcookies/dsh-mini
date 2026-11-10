import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-dsh-switch-width': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-dsh-switch-height': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-dsh-switch-width-2': { kind: 'length', units: ['px'], default: '16px' },
    '--dsw-dsh-switch-height-2': { kind: 'length', units: ['px'], default: '16px' },
  },
} as const satisfies ComponentContract
