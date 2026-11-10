/**
 * kernel-loader —— 懒载 subpkg/kernel/kernel.js 平铺导出。
 * 主包不得 require 分包文件（模块隔离），唯一合法取法是分包 boot 组件在
 * 分包上下文 require 后挂到 globalThis。轮询只读这个槽，不反复跨包 require。
 * 旧 {kernel, executor} 形状没有消费符号，kernelUsable()===false，不当半套 kernel。
 */

import { installKernelShims } from './shims'
import { reportSilent } from '../error-report'
import type { KernelModule } from './types'

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

function globalBundle(): KernelBundle | undefined {
  return (globalThis as Record<string, unknown>).__dshKernelBundle as KernelBundle | undefined
}

export function loadKernel(): KernelBundle | undefined {
  if (cached !== undefined) return cached
  const bundle = globalBundle()
  if (bundle !== undefined) {
    installKernelShims()
    cached = bundle
  }
  return cached
}

/**
 * 等 kernel 就绪：分包下载完成后 boot 组件在分包上下文 require 并挂
 * globalThis.__dshKernelBundle。主包只轮询这个槽，绝不跨包 require。
 */
export async function loadKernelAsync(timeoutMs = 25000): Promise<KernelBundle | undefined> {
  const first = loadKernel()
  if (first !== undefined) return first
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const probe = loadKernel()
    if (probe !== undefined) return probe
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
  const manifest = (globalThis as Record<string, unknown>).__dshKernelManifest as { exports?: unknown } | undefined
  const listed = Array.isArray(manifest?.exports)
    ? manifest.exports.filter((n): n is string => typeof n === 'string')
    : []
  if (listed.length === 0) return false
  if (!HOST_CONSUMED.every((name) => listed.includes(name))) return false
  const flat = b as unknown as Record<string, unknown>
  // 旧双命名空间把符号藏在 .kernel 下，根上没有这些函数。
  return HOST_CONSUMED.every((fn) => typeof flat[fn] === 'function')
}

/** 测试用：重置缓存（换产物后重测）。 */
export function kernelLoaderReset(): void {
  cached = undefined
  delete (globalThis as Record<string, unknown>).__dshKernelError
  delete (globalThis as Record<string, unknown>).__dshKernelBundle
  delete (globalThis as Record<string, unknown>).__dshKernelManifest
}
