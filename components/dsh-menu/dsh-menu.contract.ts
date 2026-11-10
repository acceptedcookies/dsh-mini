import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-dsh-menu-max-height': { kind: 'length', units: ['px'], default: '320px' },
    '--dsw-dsh-menu-min-height': { kind: 'length', units: ['px'], default: '34px' },
    '--dsw-dsh-menu-gap': { kind: 'length', units: ['px'], default: '1px' },
    '--dsw-dsh-menu-gap-2': { kind: 'length', units: ['px'], default: '5px' },
  },
} as const satisfies ComponentContract
