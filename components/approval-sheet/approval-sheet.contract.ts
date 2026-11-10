import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-approval-sheet-max-width': { kind: 'length', units: ['px'], default: '760px' },
    '--dsw-approval-sheet-width': { kind: 'length', units: ['px'], default: '6px' },
    '--dsw-approval-sheet-height': { kind: 'length', units: ['px'], default: '6px' },
    '--dsw-approval-sheet-max-height': { kind: 'length', units: ['px'], default: '336px' },
    '--dsw-approval-sheet-min-width': { kind: 'length', units: ['px'], default: '88px' },
    '--dsw-approval-sheet-height-2': { kind: 'length', units: ['px'], default: '32px' },
  },
} as const satisfies ComponentContract
