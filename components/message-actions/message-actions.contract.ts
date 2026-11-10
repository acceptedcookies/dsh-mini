import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-message-actions-height': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-message-actions-width': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-message-actions-height-2': { kind: 'length', units: ['px'], default: '28px' },
  },
} as const satisfies ComponentContract
