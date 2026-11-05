/**
 * mp 侧 local tick（T-O-9）：App 级前台 30s interval + 启动 catch-up。
 * onLaunch → startupCatchUp()；onShow → startForegroundTick()；
 * onHide → stopForegroundTick() + pending-catchup 标记。
 * 本地车道 owner='local'，alarm 替身键区经 localCas。
 */

import { ioStateFor } from '../state/provider'
import { loadKernelAsync } from './kernel-loader'
import { sweepTick, type PumpCtx } from './pump'
import { createIoTool } from './io/tool'
import { createIoLlm } from './io/llm'
import type { Io } from './types'

const PENDING_KEY = 'dsh:mini:pending-catchup'
const TICK_MS = 30_000
const HOLDER = 'mp-foreground'

let timer: ReturnType<typeof setInterval> | undefined

function ioFor(sessionId: string): Io {
  return { llm: createIoLlm(), tool: createIoTool(sessionId), state: ioStateFor() }
}

export async function nanoMiniCatchUp(): Promise<string[]> {
  // loadKernel 同步面的 tried 闩会把 onLaunch 首败（分包未就绪）永久锁存——
  // async 面轮询等待分包下载，launch catch-up 不哑火（审查四轮 F7）。
  const bundle = await loadKernelAsync()
  if (bundle === undefined) return []
  const ctx: PumpCtx = { kernel: bundle.kernel, io: ioFor(''), owner: 'local', holder: HOLDER }
  const ran = await sweepTick(ctx, { batchLimit: 10 }, ioFor)
  // fenced/claim-denied/step-exhausted 算 ran 但恢复未成——pending 不得误清（审查 B5）
  const settled = ran.length > 0 && ran.every((r) => r.outcome === 'completed' || r.outcome === 'suspended')
  if (settled) wx.setStorageSync(PENDING_KEY, false)
  return ran.map((r) => `${r.sessionId}:${r.outcome}`)
}

export function nanoMiniStartTick(): void {
  if (timer !== undefined) return
  const pending = wx.getStorageSync(PENDING_KEY) as boolean | '' | undefined
  if (pending === true) nanoMiniCatchUp().catch((e) => console.warn('[nano-mini] pending catchUp failed:', e))
  timer = setInterval(() => {
    nanoMiniCatchUp().catch((e) => console.warn('[nano-mini] tick catchUp failed:', e))
  }, TICK_MS)
}

export function nanoMiniStopTick(): void {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
  wx.setStorageSync(PENDING_KEY, true)
}
