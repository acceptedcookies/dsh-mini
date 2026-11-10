import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-goal-bar-height': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-goal-bar-width': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-goal-bar-height-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-goal-bar-min-height': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-goal-bar-min-height-2': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-goal-bar-max-height': { kind: 'length', units: ['px'], default: '96px' },
  },
} as const satisfies ComponentContract
