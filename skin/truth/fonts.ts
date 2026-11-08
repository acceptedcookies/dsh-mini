/** MS01 真源 · fonts 族（顶层 mode 不变式；消费面划出，MS01 空数组占位） */
import type { Layer } from './_shared'

export interface FontDecl {
  family: string
  src: string
  weight?: string
  desc?: string
}

export const FONT_LAYER: Layer = 'top-level'

export const FONT_ENTRIES: FontDecl[] = []
