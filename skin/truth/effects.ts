/** MS01 真源 · effects 族（v1 草案预留；MS01 不投影、不计入 151 词表） */
export interface EffectEntry {
  key: string
  light: string
  dark: string
  /** true = 草案预留，未进 T-O-B6 词表基线；MS02 视觉改造时转正 */
  provisional: boolean
  source: string
}

export const EFFECT_ENTRIES: EffectEntry[] = [
  {
    key: '--dsw-blur-surface',
    light: 'blur(20px)',
    dark: 'blur(20px)',
    provisional: true,
    source: 'docs/eval/mini-skin/skin-policy-JSON-v1.md:377',
  },
]
