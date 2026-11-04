/**
 * 纯资源分包（app.json subpackages pages:[]）真机上永不被导航到 → 不自动下载；
 * require/instantiate 直接打到未下载分包 = "load wasm failed" 类错误。
 * 使用前必须显式触发下载；本模块提供带缓存的预热入口。
 * 真机实测（微信 8.0.80 / 基础库 3.17.6）：wx.loadSubpackage 不存在，
 * wx.preDownloadSubpackage 可用——双 API 探测，preload 优先。
 */

interface WxSubpackageApi {
  loadSubpackage?: (o: { name: string; success?: () => void; fail?: (e: { errMsg?: string }) => void }) => void
  preDownloadSubpackage?: (o: {
    packageType: 'subpackage'
    name: string
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }) => void
}

/** app.json subpackages.root → name 映射（loadSubpackage 按 name 寻址）。 */
const NAME_BY_ROOT: Record<string, string> = {
  'subpkg/fx': 'fxcore',
  'subpkg/kernel': 'kernel',
}

const pending = new Map<string, Promise<void>>()

export function ensureSubpackage(name: string): Promise<void> {
  let p = pending.get(name)
  if (p === undefined) {
    p = new Promise<void>((resolve, reject) => {
      const api = (globalThis as unknown as { wx?: WxSubpackageApi }).wx
      if (typeof api?.loadSubpackage === 'function') {
        api.loadSubpackage({
          name,
          success: () => resolve(),
          fail: (e) => reject(new Error(`loadSubpackage ${name} → ${e.errMsg ?? 'failed'}`)),
        })
        return
      }
      if (typeof api?.preDownloadSubpackage === 'function') {
        api.preDownloadSubpackage({
          packageType: 'subpackage',
          name,
          success: () => resolve(),
          fail: (e) => reject(new Error(`preDownloadSubpackage ${name} → ${e.errMsg ?? 'failed'}`)),
        })
        return
      }
      resolve()
    }).catch((e: unknown) => {
      pending.delete(name)
      throw e
    })
    pending.set(name, p)
  }
  return p
}

/** 按包内路径推导所属分包并确保下载；非分包路径立即 resolve。 */
export function ensureSubpackageForPath(path: string): Promise<void> {
  const name = NAME_BY_ROOT[path.split('/').slice(0, 2).join('/')]
  return name === undefined ? Promise.resolve() : ensureSubpackage(name)
}
