import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-command-menu-background': { kind: 'color', default: 'transparent' },
    '--dsw-command-menu-min-height': { kind: 'length', units: ['px'], default: '23px' },
    '--dsw-command-menu-margin-top': { kind: 'length', units: ['px'], default: '3px' },
    '--dsw-command-menu-min-height-2': { kind: 'length', units: ['px'], default: '34px' },
    '--dsw-command-menu-width': { kind: 'length', units: ['px'], default: '14px' },
    '--dsw-command-menu-height': { kind: 'length', units: ['px'], default: '14px' },
    '--dsw-command-menu-max-width': { kind: 'length', units: ['%'], default: '40%' },
    '--dsw-command-menu-max-width-2': { kind: 'length', units: ['%'], default: '20%' },
  },
} as const satisfies ComponentContract
