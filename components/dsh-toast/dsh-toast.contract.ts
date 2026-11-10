import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-dsh-toast-left': { kind: 'length', units: ['%'], default: '50%' },
  },
} as const satisfies ComponentContract
