/**
 * 纯资源分包（app.json subpackages pages:[]）真机上永不被导航到 → 不自动下载；
 * require/instantiate 直接打到未下载分包 = "load wasm failed" 类错误。
 * 真机+官方文档实测：
 *  - wx.loadSubpackage 仅独立分包可用（本机 undefined）
 *  - wx.preDownloadSubpackage 仅支持 packageType:"workers"，普通分包不可用
 *  ⇒ 普通分包唯一预载通道 = app.json preloadRule（进入 workspace 页即触发）；
 *    下载异步——消费端须轮询等待产物可用（loadKernelAsync / instantiate 重试）。
 *  本模块保留 loadSubpackage 探测（独立分包/老基础库存在时仍走它）。
 */

interface WxSubpackageApi {
  loadSubpackage?: (o: { name: string; success?: () => void; fail?: (e: { errMsg?: string }) => void }) => void
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
      // 无 API（普通分包常态）：preloadRule 已负责触发下载——直返，由消费端轮询等待
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

/**
 * 导航引导：普通分包无下载 API 时，navigateTo 分包内占位页 = 官方下载触发器。
 * 页内 onReady 置全局标记 + navigateBack（一次空页闪现，dev 机制）。
 */
export function navEnsureSubpackage(pageUrl: string): void {
  const nav = (globalThis as { wx?: { navigateTo?: (o: { url: string }) => void } }).wx
  if (typeof nav?.navigateTo === 'function') {
    try {
      nav.navigateTo({ url: pageUrl })
    } catch {
      /* 导航冲突时静默——消费端轮询兜底 */
    }
  }
}
