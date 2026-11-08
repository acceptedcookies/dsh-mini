/** MS01 联邦真源 · 手写（T-O-3）；值/元数据以本文件为准，禁止手改任何投影产物。 */
import type { TokenEntry } from './_shared'

export const ELEVATION_ENTRIES: TokenEntry[] = [
  {
    key: "--dsw-elevation-prominent",
    family: "elevation",
    domain: "shadow",
    light: "0 8px 32px rgba(15, 17, 21, 0.16), 0 1px 2px rgba(15, 17, 21, 0.08)",
    dark: "0 8px 32px rgba(0, 0, 0, 0.48), 0 1px 2px rgba(0, 0, 0, 0.3)",
    darkOverridden: true,
    writable: true,
    invariant: false,
    derived: false,
    retired: false,
    linkedWith: [],
    source: "app.less:32"
  },
  {
    key: "--dsw-elevation-soft",
    family: "elevation",
    domain: "shadow",
    light: "0 1px 2px rgba(15, 17, 21, 0.04), 0 4px 16px rgba(15, 17, 21, 0.04)",
    dark: "0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2)",
    darkOverridden: true,
    writable: true,
    invariant: false,
    derived: false,
    retired: false,
    linkedWith: [],
    source: "app.less:67"
  },
  {
    key: "--dsw-elevation-sidebar",
    family: "elevation",
    domain: "shadow",
    light: "12px 0 40px rgba(0, 0, 0, 0.16)",
    dark: "12px 0 40px rgba(0, 0, 0, 0.16)",
    darkOverridden: false,
    writable: false,
    invariant: true,
    derived: false,
    retired: false,
    linkedWith: [],
    source: "app.less:151"
  },
  {
    key: "--dsw-elevation-drawer",
    family: "elevation",
    domain: "shadow",
    light: "-12px 0 40px rgba(0, 0, 0, 0.14)",
    dark: "-12px 0 40px rgba(0, 0, 0, 0.14)",
    darkOverridden: false,
    writable: false,
    invariant: true,
    derived: false,
    retired: false,
    linkedWith: [],
    source: "app.less:152"
  }
]
