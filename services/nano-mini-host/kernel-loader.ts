/**
 * kernel-loader —— 懒载 subpkg/kernel/kernel.js 双命名空间产物。
 * mp 侧 require 分包文件；加载失败（缺产物/JSC 不兼容）→ isUsable()=false
 * 由 bindRuntime 探测回退 fx/localRuntime（P2-06）。
 */

import { installKernelShims } from './shims'
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
      // 降级必须可观察（静默回退 fx/demo 的盲区——审查 P2）：console 为 mp 侧唯一通道
      console.warn('[kernel-loader] subpkg/kernel 加载失败，回退 fx/localRuntime:', e)
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
 * 等 kernel 分包就绪：普通分包无程序化下载 API（preloadRule 触发后是异步下载），
 * 轮询 require 直至命中或超时；成功路径写入缓存（loadKernel 直读）。
 */
export async function loadKernelAsync(timeoutMs = 20000): Promise<KernelBundle | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const b = loadKernel()
    if (b !== undefined) return b
    const probe = tryRequireQuiet()
    if (probe !== undefined) {
      cached = probe
      return probe
    }
    if (Date.now() >= deadline) return undefined
    kernelLoaderReset()
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
}
