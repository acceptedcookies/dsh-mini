import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-right-panel-width': { kind: 'length', units: ['px'], default: '380px' },
    '--dsw-right-panel-height': { kind: 'length', units: ['px'], default: '38px' },
    '--dsw-right-panel-width-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-right-panel-height-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-right-panel-height-3': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-right-panel-min-height': { kind: 'length', units: ['px'], default: '52px' },
    '--dsw-right-panel-width-3': { kind: 'length', units: ['px'], default: '32px' },
    '--dsw-right-panel-height-4': { kind: 'length', units: ['px'], default: '32px' },
    '--dsw-right-panel-min-height-2': { kind: 'length', units: ['px'], default: '52px' },
    '--dsw-right-panel-width-4': { kind: 'length', units: ['px'], default: '32px' },
    '--dsw-right-panel-height-5': { kind: 'length', units: ['px'], default: '32px' },
    '--dsw-right-panel-margin-top': { kind: 'length', units: ['px'], default: '8px' },
    '--dsw-right-panel-height-6': { kind: 'length', units: ['px'], default: '40px' },
    '--dsw-right-panel-height-7': { kind: 'length', units: ['px'], default: '40px' },
    '--dsw-right-panel-max-width': { kind: 'length', units: ['px'], default: '260px' },
    '--dsw-right-panel-width-5': { kind: 'length', units: ['px'], default: '6px' },
    '--dsw-right-panel-height-8': { kind: 'length', units: ['px'], default: '6px' },
    '--dsw-right-panel-margin-top-2': { kind: 'length', units: ['px'], default: '7px' },
    '--dsw-right-panel-min-height-3': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-right-panel-min-height-4': { kind: 'length', units: ['px'], default: '40px' },
  },
} as const satisfies ComponentContract
