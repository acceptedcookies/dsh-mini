/** components 族：glob 收编，零中央登记。条目由 build-skin 从 *.contract.ts 读入。 */
import type { ComponentEntry, Layer } from './_shared'

export const COMPONENT_LAYER: Layer = 'top-level'

/** 组件合同文件命名约定：`components/<name>/<name>.contract.ts`。 */
export const CONTRACT_FILE_GLOB = 'components/*/*.contract.ts'

/** 不手工登记。空数组不是「无合约」；合约文件由 CONTRACT_FILE_GLOB 发现。 */
export const COMPONENT_ENTRIES: ComponentEntry[] = []
