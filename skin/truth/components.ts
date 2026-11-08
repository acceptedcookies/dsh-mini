/** MS01 真源 · components 族（MS02 握手面；manifest 四子域 + glob 收编约定） */
import type { ComponentEntry, ComponentManifest, Layer } from './_shared'

export const COMPONENT_LAYER: Layer = 'top-level'

/** 组件 manifest 文件命名约定：`components/<name>/<name>.contract.ts`。 */
export const CONTRACT_FILE_GLOB = 'components/*/*.contract.ts'

/** MS01 空 registry：validator L6 对任何组件名一律拒绝（不空转=接受）。 */
export const COMPONENT_ENTRIES: ComponentEntry[] = []

export type { ComponentManifest }
