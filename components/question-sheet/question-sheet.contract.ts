import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-question-sheet-max-width': { kind: 'length', units: ['px'], default: '760px' },
    '--dsw-question-sheet-max-height': { kind: 'length', units: ['vh'], default: '60vh' },
    '--dsw-question-sheet-width': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-question-sheet-height': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-question-sheet-min-height': { kind: 'length', units: ['px'], default: '40px' },
    '--dsw-question-sheet-width-2': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-question-sheet-height-2': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-question-sheet-margin-top': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-question-sheet-width-3': { kind: 'length', units: ['px'], default: '14px' },
    '--dsw-question-sheet-height-3': { kind: 'length', units: ['px'], default: '14px' },
    '--dsw-question-sheet-min-height-2': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-question-sheet-max-height-2': { kind: 'length', units: ['px'], default: '96px' },
    '--dsw-question-sheet-width-4': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-question-sheet-height-4': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-question-sheet-min-width': { kind: 'length', units: ['px'], default: '64px' },
    '--dsw-question-sheet-height-5': { kind: 'length', units: ['px'], default: '32px' },
  },
} as const satisfies ComponentContract
