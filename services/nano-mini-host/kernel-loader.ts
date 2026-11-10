/**
 * kernel-loader —— 懒载 subpkg/kernel/kernel.js 平铺导出。
 * 旧 {kernel, executor} 形状没有消费符号，kernelUsable()===false，不当半套 kernel。
 */

import { installKernelShims } from './shims'
import { reportSilent } from '../error-report'
import type { KernelModule } from './types'

declare const require: (path: string) => unknown

/** 平铺产物。消费子集在 KernelModule；没有 kernel/executor 命名空间字段。 */
export type KernelBundle = KernelModule

const HOST_CONSUMED = [
  'createInitialSessionState',
  'createKernelSnapshot',
  'applyAction',
  'scheduleNextStep',
  'buildCheckpointFragment',
  'restoreFromFragment',
] as const

let cached: KernelBundle | undefined
let tried = false

export function loadKernel(): KernelBundle | undefined {
  if (!tried) {
    tried = true
    try {
      installKernelShims()
      cached = require('../../subpkg/kernel/kernel.js') as KernelBundle
    } catch {
      // 冷启首探失败是常态（分包未下载/未流到即必败）——仅探测不上报，
      // 真实失败由 loadKernelAsync 耗尽/引导页重试穷尽后统一台账化，
      // 否则每次冷启都在 errors.all 留一条自愈噪音（真机 dump 实证）。
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
 * 等 kernel 就绪：分包未下载时主包 require 必败；下载完成后主包 require
 * 即可解析（真机实测）。分包上下文的 require 由常驻不可见组件
 * subpkg/kernel/boot 承担（挂载即驱动下载、零路由跳变=零闪屏——
 * 占位页 navigateTo 白闪根因的根治，导航通道已废除）。
 * 轮询期间主包/组件两条路径谁先到谁生效；超时或组件侧穷尽才记台账。
 */
export async function loadKernelAsync(timeoutMs = 25000): Promise<KernelBundle | undefined> {
  const first = loadKernel()
  if (first !== undefined) return first
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const probe = tryRequireQuiet() ?? ((globalThis as Record<string, unknown>).__dshKernelBundle as KernelBundle | undefined)
    if (probe !== undefined) {
      cached = probe
      tried = true
      return probe
    }
    // boot 组件 require 硬失败（产物缺失/JSC 不兼容）——继续轮询无意义，早退可观察
    const loadErr = (globalThis as Record<string, unknown>).__dshKernelError
    if (loadErr !== undefined) {
      console.warn('[kernel-loader] boot 组件 require 失败:', loadErr)
      reportSilent(loadErr instanceof Error ? loadErr : new Error(String(loadErr)), { op: 'kernel-bootstrap', lane: 'background' })
      return undefined
    }
    if (Date.now() >= deadline) {
      // 耗尽=真缺席（组件侧重试穷尽 + 主包轮询全灭）——此刻才值得记台账
      reportSilent(new Error('kernel subpkg 等待超时'), { op: 'kernel-load-timeout', lane: 'background' })
      return undefined
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}

export function kernelUsable(): boolean {
  const b = loadKernel()
  if (b === undefined) return false
  let listed: string[] = []
  try {
    const manifest = require('../../subpkg/kernel/manifest.json') as { exports?: unknown }
    listed = Array.isArray(manifest.exports) ? manifest.exports.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return false
  }
  if (listed.length === 0) return false
  if (!HOST_CONSUMED.every((name) => listed.includes(name))) return false
  const flat = b as unknown as Record<string, unknown>
  // 旧双命名空间把符号藏在 .kernel 下，根上没有这些函数。
  return HOST_CONSUMED.every((fn) => typeof flat[fn] === 'function')
}

/** 测试用：重置缓存（换产物后重测）。 */
export function kernelLoaderReset(): void {
  cached = undefined
  tried = false
  delete (globalThis as Record<string, unknown>).__dshKernelError
  delete (globalThis as Record<string, unknown>).__dshKernelBundle
}
