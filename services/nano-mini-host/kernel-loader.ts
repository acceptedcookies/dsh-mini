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
