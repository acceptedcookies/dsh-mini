/**
 * kernel-loader —— 懒载 subpkg/kernel/kernel.js 双命名空间产物。
 * mp 侧 require 分包文件；加载失败（缺产物/JSC 不兼容）→ isUsable()=false
 * 由 bindRuntime 探测回退 fx/localRuntime（P2-06）。
 */

import { installKernelShims } from './shims'
import { reportSilent } from '../error-report'
import type { KernelModule } from './types'

declare const require: (path: string) => unknown

interface KernelBundle {
  kernel: KernelModule
  executor?: unknown
}

let cached: KernelBundle | undefined
let tried = false

export function loadKernel(): KernelBundle | undefined {
  if (!tried) {
    tried = true
    try {
      installKernelShims()
      cached = require('../../subpkg/kernel/kernel.js') as KernelBundle
    } catch (e) {
      // 降级必须可观察（静默回退 fx/demo 的盲区——审查 P2）：console 为 mp 侧唯一通道；
      // silent 台账让 kernel 缺席在诊断面可见而非仅 console（MN03-R2）。
      console.warn('[kernel-loader] subpkg/kernel 加载失败，回退 fx/localRuntime:', e)
      reportSilent(e, { op: 'kernel-load', lane: 'background' })
      cached = undefined
    }
  }
  return cached
}

/** 静默探测：preloadRule 下载未完成时 require 必败——轮询期间不打 warn（避免刷屏）。 */
function tryRequireQuiet(): KernelBundle | undefined {
  try {
    installKernelShims()
    return require('../../subpkg/kernel/kernel.js') as KernelBundle
  } catch {
    return undefined
  }
}

/**
 * 等 kernel 就绪：主包 require 分包被模块隔离禁止（真机实证：下载完成也
 * module not defined）——导航引导页是唯一合法通道：navigateTo 触发下载，
 * 分包页内同包 require 后挂 globalThis.__dshKernelBundle。
 * 轮询静默探测直至就绪/超时；成功路径写缓存（loadKernel 直读）。
 */
export async function loadKernelAsync(timeoutMs = 25000): Promise<KernelBundle | undefined> {
  const first = loadKernel()
  if (first !== undefined) return first
  const nav = (globalThis as { wx?: { navigateTo?: (o: { url: string }) => void } }).wx
  let navigated = false
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const probe = tryRequireQuiet() ?? ((globalThis as Record<string, unknown>).__dshKernelBundle as KernelBundle | undefined)
    if (probe !== undefined) {
      cached = probe
      tried = true
      return probe
    }
    // 引导页 require 硬失败（产物缺失/JSC 不兼容）——继续轮询无意义，早退可观察
    const loadErr = (globalThis as Record<string, unknown>).__dshKernelError
    if (loadErr !== undefined) {
      console.warn('[kernel-loader] 引导页 require 失败:', loadErr)
      reportSilent(loadErr instanceof Error ? loadErr : new Error(String(loadErr)), { op: 'kernel-bootstrap', lane: 'background' })
      return undefined
    }
    if (Date.now() >= deadline) return undefined
    if (!navigated && typeof nav?.navigateTo === 'function') {
      navigated = true
      try {
        nav.navigateTo({ url: '/subpkg/kernel/p/index' })
      } catch {
        /* 导航冲突静默——轮询兜底 */
      }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}

export function kernelUsable(): boolean {
  const b = loadKernel()
  const k = b?.kernel
  // 探测全决策环所需导出面（非只验两函数——残缺 bundle 不得误判 usable）
  return k !== undefined
    && ['createInitialSessionState', 'createKernelSnapshot', 'applyAction',
      'scheduleNextStep', 'buildCheckpointFragment', 'restoreFromFragment']
      .every((fn) => typeof (k as unknown as Record<string, unknown>)[fn] === 'function')
}

/** 测试用：重置缓存（换产物后重测）。 */
export function kernelLoaderReset(): void {
  cached = undefined
  tried = false
  delete (globalThis as Record<string, unknown>).__dshKernelError
}
