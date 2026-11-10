import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-error-center-left': { kind: 'length', units: ['%'], default: '50%' },
    '--dsw-error-center-min-width': { kind: 'length', units: ['px'], default: '220px' },
    '--dsw-error-center-margin-top': { kind: 'length', units: ['px'], default: '1px' },
    '--dsw-error-center-width': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-error-center-height': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-error-center-max-height': { kind: 'length', units: ['%'], default: '100%' },
    '--dsw-error-center-width-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-error-center-height-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-error-center-max-height-2': { kind: 'length', units: ['px'], default: '160px' },
    '--dsw-error-center-max-height-3': { kind: 'length', units: ['px'], default: '240px' },
    '--dsw-error-center-width-3': { kind: 'length', units: ['px'], default: '76px' },
  },
} as const satisfies ComponentContract
