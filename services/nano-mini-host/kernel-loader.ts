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
    } catch {
      cached = undefined
    }
  }
  return cached
}

export function kernelUsable(): boolean {
  const b = loadKernel()
  return b !== undefined
    && typeof b.kernel?.scheduleNextStep === 'function'
    && typeof b.kernel?.restoreFromFragment === 'function'
}

/** 测试用：重置缓存（换产物后重测）。 */
export function kernelLoaderReset(): void {
  cached = undefined
  tried = false
}
