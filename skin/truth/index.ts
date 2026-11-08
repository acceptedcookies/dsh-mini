/** MS01 联邦真源聚合出口（手写）——build-skin/engine/node-checks 的统一输入。
 *  注意：effects 的 `--dsw-blur-surface` 为草案预留（provisional），不计入 151 词表。
 */
import type { TokenEntry } from './_shared'
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

export const ALL_TOKEN_ENTRIES: TokenEntry[] = [
  ...PALETTE_ENTRIES,
  ...SHAPE_ENTRIES,
  ...SPACING_ENTRIES,
  ...TYPOGRAPHY_ENTRIES,
  ...ELEVATION_ENTRIES,
]

/** 投影键（derived 不产出）：118 可声明 + 16 invariant = 134 */
export const PROJECTED_ENTRIES: TokenEntry[] = ALL_TOKEN_ENTRIES.filter((e) => !e.retired)
