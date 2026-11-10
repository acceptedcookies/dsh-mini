/**
 * MS01 联邦真源 · 共享 primitives（手写真源，非生成物）
 *
 * 本文件是 `skin/truth/*` 的唯一类型与规则基座：
 *  - Domain / Family / Layer 枚举（schema v1 值域与层级）
 *  - TokenEntry / SurfaceEntry / AssetEntry / SoundEntry / ChromeEntry
 *  - 联动簇（skin-policy-JSON-v1.md §6.2 九条约束）
 *  - `emitName()`：surface dotted key → dashed-ident（MS01-E3 sanitize 唯一实现）
 */
export type Domain =
  | 'color'
  | 'length'
  | 'duration'
  | 'family-string'
  | 'font-weight'
  | 'background-shorthand'
  | 'shadow'
  | 'filter'
  | 'tracking'
  | 'derived-reference'

export type Family =
  | 'palette'
  | 'surfaces'
  | 'shape'
  | 'spacing'
  | 'typography'
  | 'assets'
  | 'elevation'
  | 'effects'
  | 'chrome'
  | 'fonts'
  | 'sounds'
  | 'components'

/** top-level = mode 不变式族；mode-block = light/dark 双块族（T-O-B2） */
export type Layer = 'top-level' | 'mode-block'

export interface TokenEntry {
  key: string
  family: Family
  domain: Domain
  light: string
  dark: string
  /** 皮肤可写性：invariant/derived 恒 false */
  writable: boolean
  /** 不变式键：仍产出（今日在役），但任何皮肤覆写 = 拒绝 */
  invariant: boolean
  /** 派生 legacy 别名：不产出、拒写（T-O-8 退役） */
  derived: boolean
  retired: boolean
  /** 联动簇建议共改（validator 告警级，非拒绝） */
  linkedWith: string[]
  /** 原 `.theme-dark{}` 是否覆写该键（55 键口径的组成部分） */
  darkOverridden: boolean
  /** 真源可追溯锚：`app.less:NN` */
  source: string
}

export interface SurfacePoint {
  file: string
  line: number
  /** 该点当前吃的 token（用于 P4 改指等价核验） */
  use: string
}

export interface SurfaceEntry {
  key: string
  /** 生成的 CSS 自定义属性名（唯一合法 dashed-ident） */
  emits: string
  /** 面级默认值：今日所吃 token 的 var() 引用 */
  default: string
  points: SurfacePoint[]
  note?: string
}

export interface AssetEntry {
  key: string
  kind: 'image' | 'video' | 'icon'
  /** import 面划出期字段留空；MS02/MS01.5 落端点 */
  light?: string
  dark?: string
  note?: string
}

export interface SoundEntry {
  key: string
  /** 服务落地后迁回自然真源（T-O-3 登记） */
  event: string
}

export interface ChromeEntry {
  key: 'navBackground' | 'navFront' | 'pullBackground'
  light: string
  dark: string
}

export interface VarDomainBase {
  /** 必填，等于该组件改造前字面量。 */
  default: string
}

export type VarDomain =
  | ({ kind: 'length'; units: readonly ('px' | '%' | 'vh' | 'vw')[]; min?: number; max?: number } & VarDomainBase)
  | ({ kind: 'color' } & VarDomainBase)
  | ({ kind: 'enum'; values: readonly string[] } & VarDomainBase)

export interface ComponentContract {
  /** 构建期格式 `major.minor.patch`。validate 不比较它。 */
  contractVersion: string
  layout?: readonly string[]
  vars?: Record<`--dsw-${string}-${string}`, VarDomain>
  options?: Record<string, readonly (string | boolean)[]>
  assets?: Record<string, 'image' | 'video' | 'icon'>
}

export interface ComponentEntry {
  name: string
  manifest: ComponentContract
}

/** 联动簇（§6.2 九条）：validator L3 判定「组合护栏」的数据源（告警级）。 */
export const LINKAGE_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['--dsw-alias-button-primary-fill', '--dsw-alias-label-primary-foreground'],
  [
    '--dsw-alias-button-info-fill',
    '--dsw-alias-button-info-hover',
    '--dsw-alias-state-business-primary',
    '--dsw-alias-label-deep-diving',
    '--dsw-alias-label-deep-diving-shimmer',
    '--dsw-alias-state-business-tertiary',
    '--dsw-alias-label-primary-bluish',
  ],
  ['--dsw-sidebar-list-fade', '--dsw-specific-sidebar-fill'],
  ['--dsw-menu-surface-fill', '--dsw-alias-bg-base'],
  ['--dsw-alias-toast-bg', '--dsw-alias-toast-label'],
  ['--dsw-alias-state-warn-tertiary', '--dsw-alias-state-warn-label'],
  ['--dsw-alias-code-diff-added', '--dsw-alias-state-success-primary'],
  ['--dsw-alias-code-diff-deleted', '--dsw-alias-state-error-primary'],
  ['--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-inline-code'],
]

/** surface dotted key → 合法 dashed-ident 片段（`.` → `-`）。 */
export function emitName(key: string): string {
  return key.replace(/\./g, '-')
}

/** surface 键 → `--dsw-surface-*` 变量名（唯一拼接点）。 */
export function surfaceEmit(key: string): string {
  return `--dsw-surface-${emitName(key)}`
}

/** emits 合法 dashed-ident 断言正则（E3 / validator L5） */
export const SURFACE_EMIT_RE = /^--dsw-surface-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 键是否属于某个联动簇（返回同簇其他键）。 */
export function linkedWithOf(key: string): string[] {
  for (const group of LINKAGE_GROUPS) {
    if (group.includes(key)) return group.filter((k) => k !== key)
  }
  return []
}
