import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-reasoning-row-margin-bottom': { kind: 'length', units: ['px'], default: '16px' },
    '--dsw-reasoning-row-height': { kind: 'length', units: ['px'], default: '24px' },
    '--dsw-reasoning-row-width': { kind: 'length', units: ['px'], default: '16px' },
    '--dsw-reasoning-row-height-2': { kind: 'length', units: ['px'], default: '16px' },
    '--dsw-reasoning-row-width-2': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-reasoning-row-height-3': { kind: 'length', units: ['px'], default: '2px' },
    '--dsw-reasoning-row-color': { kind: 'color', default: 'transparent' },
    '--dsw-reasoning-row--webkit-text-fill-color': { kind: 'color', default: 'transparent' },
  },
} as const satisfies ComponentContract
