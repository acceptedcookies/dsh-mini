import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  layout: ['dock-bottom'],
  vars: {
    '--dsw-upd-height': { kind: 'length', units: ['vh'], default: '33.333vh' },
    '--dsw-upd-close-top': { kind: 'length', units: ['px'], default: '-44px' },
    '--dsw-upd-close-size': { kind: 'length', units: ['px'], default: '30px' },
  },
  options: {},
  assets: {},
} as const satisfies ComponentContract
