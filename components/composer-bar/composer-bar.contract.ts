import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-composer-bar-padding-top': { kind: 'length', units: ['px'], default: '8px' },
    '--dsw-composer-bar-width': { kind: 'length', units: ['px'], default: '56px' },
    '--dsw-composer-bar-height': { kind: 'length', units: ['px'], default: '56px' },
    '--dsw-composer-bar-top': { kind: 'length', units: ['px'], default: '-6px' },
    '--dsw-composer-bar-right': { kind: 'length', units: ['px'], default: '-6px' },
    '--dsw-composer-bar-width-2': { kind: 'length', units: ['px'], default: '18px' },
    '--dsw-composer-bar-height-2': { kind: 'length', units: ['px'], default: '18px' },
    '--dsw-composer-bar-min-height': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-composer-bar-max-height': { kind: 'length', units: ['px'], default: '240px' },
    '--dsw-composer-bar-min-height-2': { kind: 'length', units: ['px'], default: '52px' },
    '--dsw-composer-bar-width-3': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-composer-bar-height-3': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-composer-bar-max-width': { kind: 'length', units: ['px'], default: '220px' },
    '--dsw-composer-bar-height-4': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-composer-bar-max-width-2': { kind: 'length', units: ['px'], default: '220px' },
    '--dsw-composer-bar-height-5': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-composer-bar-width-4': { kind: 'length', units: ['px'], default: '34px' },
    '--dsw-composer-bar-height-6': { kind: 'length', units: ['px'], default: '34px' },
    '--dsw-composer-bar-width-5': { kind: 'length', units: ['px'], default: '14px' },
    '--dsw-composer-bar-height-7': { kind: 'length', units: ['px'], default: '14px' },
  },
} as const satisfies ComponentContract
