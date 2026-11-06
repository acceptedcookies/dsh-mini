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
 * 即可解析（真机实测）。navigateTo 引导页同时承担两个职责：
 *   1) 触发分包下载（wx.loadSubpackage 在 remote-debug 上下文缺席）
 *   2) 分包上下文 require（懒推竞态下比主包路径更早可解析）并挂
 *      globalThis.__dshKernelBundle
 * 轮询期间主包/页两条路径谁先到谁生效；超时或页侧穷尽才记台账。
 */
// 导航闩（模块级）：catchUp/bindRuntime 等并发调用者共用一次引导页跳转——
// 局部 navigated 闩各 nav 一次会叠两层 kernel 页（真机栈实证）+ 双闪。
let kernelNavInFlight = false

export async function loadKernelAsync(timeoutMs = 25000): Promise<KernelBundle | undefined> {
  const first = loadKernel()
  if (first !== undefined) return first
  const nav = (globalThis as { wx?: { navigateTo?: (o: { url: string }) => void } }).wx
  let navigated = false
  const deadline = Date.now() + timeoutMs
  // 静默宽限窗：preloadRule 后台下载通常数秒就绪，remote-debug 懒推亦在窗口内
  // 流到——先纯轮询，超时仍未就绪才导航引导页。窗口内零路由跳变=零闪屏
  // （此前 nav 在首轮即触发，引导页转场/换帧必然可见——业主反复投诉根因）。
  const navEarliest = Date.now() + Math.min(6000, Math.floor(timeoutMs / 3))
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
    if (Date.now() >= deadline) {
      // 耗尽=真缺席（页侧重试穷尽 + 主包轮询全灭）——此刻才值得记台账
      reportSilent(new Error('kernel subpkg 等待超时'), { op: 'kernel-load-timeout', lane: 'background' })
      return undefined
    }
    if (Date.now() >= navEarliest && !navigated && !kernelNavInFlight && typeof nav?.navigateTo === 'function') {
      const top = (globalThis as { getCurrentPages?: () => { route?: string }[] }).getCurrentPages?.()
      const onKernel = top?.[top.length - 1]?.route === 'subpkg/kernel/p/index'
      if (!onKernel) {
        navigated = true
        kernelNavInFlight = true
        try {
          nav.navigateTo({ url: '/subpkg/kernel/p/index' })
          // 引导页 onReady 即 navigateBack——闩随动画周期释放，防并发重入
          setTimeout(() => { kernelNavInFlight = false }, 1500)
        } catch {
          kernelNavInFlight = false
          /* 导航冲突静默——轮询兜底 */
        }
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
  kernelNavInFlight = false
  delete (globalThis as Record<string, unknown>).__dshKernelError
  delete (globalThis as Record<string, unknown>).__dshKernelBundle
}
