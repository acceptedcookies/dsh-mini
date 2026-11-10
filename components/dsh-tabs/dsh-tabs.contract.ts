import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-dsh-tabs-height': { kind: 'length', units: ['px'], default: '32px' },
    '--dsw-dsh-tabs-height-2': { kind: 'length', units: ['px'], default: '32px' },
    '--dsw-dsh-tabs-bottom': { kind: 'length', units: ['px'], default: '-1px' },
    '--dsw-dsh-tabs-height-3': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-dsh-tabs-height-4': { kind: 'length', units: ['px'], default: '34px' },
    '--dsw-dsh-tabs-margin-right': { kind: 'length', units: ['px'], default: '1px' },
    '--dsw-dsh-tabs-height-5': { kind: 'length', units: ['px'], default: '34px' },
    '--dsw-dsh-tabs-right': { kind: 'length', units: ['px'], default: '9px' },
    '--dsw-dsh-tabs-left': { kind: 'length', units: ['px'], default: '9px' },
    '--dsw-dsh-tabs-height-6': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-dsh-tabs-height-7': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-dsh-tabs-height-8': { kind: 'length', units: ['px'], default: '36px' },
    '--dsw-dsh-tabs-bottom-2': { kind: 'length', units: ['px'], default: '-0.5px' },
    '--dsw-dsh-tabs-height-9': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-dsh-tabs-height-10': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-dsh-tabs-min-width': { kind: 'length', units: ['px'], default: '64px' },
    '--dsw-dsh-tabs-max-width': { kind: 'length', units: ['px'], default: '140px' },
  },
} as const satisfies ComponentContract
