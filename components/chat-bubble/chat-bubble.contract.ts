import type { ComponentContract } from '../../skin/truth/_shared'

export const CONTRACT = {
  contractVersion: '1.0.0',
  vars: {
    '--dsw-chat-bubble-margin-top': { kind: 'length', units: ['px'], default: '20px' },
    '--dsw-chat-bubble-margin-top-2': { kind: 'length', units: ['px'], default: '8px' },
    '--dsw-chat-bubble-width': { kind: 'length', units: ['px'], default: '240px' },
    '--dsw-chat-bubble-max-width': { kind: 'length', units: ['%'], default: '100%' },
    '--dsw-chat-bubble-min-height': { kind: 'length', units: ['px'], default: '64px' },
    '--dsw-chat-bubble-width-2': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-chat-bubble-height': { kind: 'length', units: ['px'], default: '28px' },
    '--dsw-chat-bubble-width-3': { kind: 'length', units: ['px'], default: '160px' },
    '--dsw-chat-bubble-height-2': { kind: 'length', units: ['px'], default: '160px' },
    '--dsw-chat-bubble-margin-bottom': { kind: 'length', units: ['px'], default: '6px' },
    '--dsw-chat-bubble-min-height-2': { kind: 'length', units: ['px'], default: '18px' },
    '--dsw-chat-bubble-width-4': { kind: 'length', units: ['px'], default: '10px' },
    '--dsw-chat-bubble-height-3': { kind: 'length', units: ['px'], default: '10px' },
    '--dsw-chat-bubble-margin-top-3': { kind: 'length', units: ['px'], default: '5px' },
    '--dsw-chat-bubble-max-width-2': { kind: 'length', units: ['%'], default: '82%' },
  },
} as const satisfies ComponentContract
