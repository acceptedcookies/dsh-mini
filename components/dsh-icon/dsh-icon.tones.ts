/** dsh-icon tone 闭集（纯数据 + 纯函数，无 Component——E5/Node-safe） */
export const TONE_SETS = {
  accent: new Set([
    'check-outline',
    'check-circle-fill',
    'check-circle-outline',
    'plan-outline',
    'loading-outline',
    'sparkle',
    'plus-outline',
    'new-chat-outline',
  ]),
  inverse: new Set([
    'paper-plane-outline',
    'stop-fill',
    'check-outline',
    'close-fill',
    'plus-outline',
  ]),
  danger: new Set([
    'trash-outline',
    'warning-outline',
    'warning-triangle-outline',
    'close-circle-fill',
    'close-outline',
  ]),
  warn: new Set([
    'warning-outline',
    'warning-triangle-outline',
  ]),
  success: new Set([
    'check-circle-outline',
    'check-outline',
  ]),
} as const

export type ToneName = keyof typeof TONE_SETS

/** tone 语义回退（MS01 前既有逻辑，逐字保留） */
export function resolveTone(name: string, tone: string): string {
  if (tone === 'accent' && !TONE_SETS.accent.has(name)) return 'secondary'
  if (tone === 'inverse' && !TONE_SETS.inverse.has(name)) return 'primary'
  if (tone === 'danger' && !TONE_SETS.danger.has(name)) return 'secondary'
  if (tone === 'warn' && !TONE_SETS.warn.has(name)) return 'danger'
  if (tone === 'success' && !TONE_SETS.success.has(name)) return 'secondary'
  return tone
}
