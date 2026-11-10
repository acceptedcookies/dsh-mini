import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-tool-card-height': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-tool-card-left': { kind: 'length', units: ['px'], default: '22px' },
    '--dsw-tool-card--webkit-text-fill-color': { kind: 'color', default: 'transparent' },
    '--dsw-tool-card-width': { kind: 'length', units: ['px'], default: '16px' },
    '--dsw-tool-card-height-2': { kind: 'length', units: ['px'], default: '16px' },
    '--dsw-tool-card-width-2': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-tool-card-height-3': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-tool-card-max-height': { kind: 'length', units: ['px'], default: '150px' },
    '--dsw-tool-card-height-4': { kind: 'length', units: ['px'], default: '0.5px' },
  },
} as const satisfies ComponentContract
