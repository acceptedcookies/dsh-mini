/** MS01 真源 · assets 族（4 键；import 面划出，端点字段先留空） */
import type { AssetEntry } from './_shared'

export const ASSET_ENTRIES: AssetEntry[] = [
  { key: 'brand.fish', kind: 'image', note: '明暗双份；FRD1 端点随 import 面上线（T-O-5 划出）' },
  { key: 'hero.loop', kind: 'video', note: 'mp4；同上' },
  { key: 'running.whale', kind: 'image', note: '运行态鲸鱼；同上' },
  { key: 'icon.*', kind: 'icon', note: '保留族（D5）；dsh-icon 静态资产走包内路径' },
]
