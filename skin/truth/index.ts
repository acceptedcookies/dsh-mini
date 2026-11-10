/** 联邦真源聚合出口（手写）——build-skin/engine/node-checks 的统一输入。
 *  非 provisional 的 effects 并入词表，domain = filter。
 */
import type { TokenEntry } from './_shared'
import { EFFECT_ENTRIES } from './effects'
import { PALETTE_ENTRIES } from './palette'
import { SHAPE_ENTRIES } from './shape'
import { SPACING_ENTRIES } from './spacing'
import { TYPOGRAPHY_ENTRIES } from './typography'
import { ELEVATION_ENTRIES } from './elevation'

export { PALETTE_ENTRIES, SHAPE_ENTRIES, SPACING_ENTRIES, TYPOGRAPHY_ENTRIES, ELEVATION_ENTRIES }
export { SURFACE_ENTRIES } from './surfaces'
export { ASSET_ENTRIES } from './assets'
export { CHROME_ENTRIES } from './chrome'
export { SOUND_ENTRIES } from './sounds'
export { COMPONENT_ENTRIES, CONTRACT_FILE_GLOB } from './components'
export { FONT_ENTRIES } from './fonts'
export { EFFECT_ENTRIES } from './effects'

function effectTokens(): TokenEntry[] {
  return EFFECT_ENTRIES.filter((entry) => !entry.provisional).map((entry) => ({
    key: entry.key,
    family: 'effects' as const,
    domain: 'filter' as const,
    light: entry.light,
    dark: entry.dark,
    writable: true,
    invariant: false,
    derived: false,
    retired: false,
    linkedWith: [],
    darkOverridden: entry.light !== entry.dark,
    source: entry.source,
  }))
}

export const ALL_TOKEN_ENTRIES: TokenEntry[] = [
  ...PALETTE_ENTRIES,
  ...SHAPE_ENTRIES,
  ...SPACING_ENTRIES,
  ...TYPOGRAPHY_ENTRIES,
  ...ELEVATION_ENTRIES,
  ...effectTokens(),
]

/** 投影键（derived 不产出）：118 可声明 + 16 invariant = 134 */
export const PROJECTED_ENTRIES: TokenEntry[] = ALL_TOKEN_ENTRIES.filter((e) => !e.retired)
