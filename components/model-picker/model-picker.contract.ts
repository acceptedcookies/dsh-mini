import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-model-picker-width': { kind: 'length', units: ['px'], default: '260px' },
    '--dsw-model-picker-max-height': { kind: 'length', units: ['px'], default: '360px' },
    '--dsw-model-picker-min-height': { kind: 'length', units: ['px'], default: '34px' },
  },
} as const satisfies ComponentContract
