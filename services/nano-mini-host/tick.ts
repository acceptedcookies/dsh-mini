/**
 * mp 侧 local tick（T-O-9）：App 级前台 30s interval + 启动 catch-up。
 * onLaunch → startupCatchUp()；onShow → startForegroundTick()；
 * onHide → stopForegroundTick() + pending-catchup 标记。
 * 本地车道 owner='local'，alarm 替身键区经 localCas。
 */

import { ioStateFor, remoteDurableActive } from '../state/provider'
import { localCas } from '../state/local-cas'
import { engineForSession } from '../session-engine'
import { hasFreshTicket } from '../fx/ticket'
import { loadKernelAsync } from './kernel-loader'
import { sweepTick, type PumpCtx } from './pump'
import { createIoTool } from './io/tool'
import { createIoLlm } from './io/llm'
import { reportSilent } from '../error-report'
import type { Io, IoState } from './types'

const PENDING_KEY = 'dsh:mini:pending-catchup'
const TICK_MS = 30_000
const HOLDER = 'mp-foreground'

let timer: ReturnType<typeof setInterval> | undefined

function ioFor(sessionId: string): Io {
  // 后台车道不铸票：sweep 的 io.llm 无活票直接失败（pump-error→重臂），
  // 不在 30s tick/launch 上下文弹 SOTER（审查五轮 F6）。
  // 引擎戳记分道（MN03）：恢复该会话时 io.llm/io.state 全走它自己的车道——
  // magpie 会话绝不会被远端 sweeper 用 BYOK 车道偷换上游恢复。
  const engine = engineForSession(sessionId)
  return { llm: createIoLlm({ noMint: true, engine }), tool: createIoTool(sessionId), state: ioStateFor(engine) }
}

let catchUpInFlight: Promise<string[]> | undefined

export function nanoMiniCatchUp(): Promise<string[]> {
  // setInterval 不 await 前次 promise——loadKernelAsync 轮询（最长 ~20s）拉长
  // catchUp 后并发 sweepTick 可达：同 holder claim 双通，先烧 llm/tool 才被
  // CAS 栅栏拦下（审查五轮）。单飞收敛：并发调用方共享同一 promise。
  catchUpInFlight ??= doCatchUp().finally(() => {
    catchUpInFlight = undefined
  })
  return catchUpInFlight
}

async function doCatchUp(): Promise<string[]> {
  // 分车道 sweep（MN03 引擎戳记）：localCas 恒扫——magpie 会话行在此，
  // 无票不该饿死本地恢复；remote durable 半程保无票跳过原语义（业主 W2：
  // 后台面无手势上下文，发请求只会收获 401——预检跳过而非事后静默）。
  // loadKernel 同步面的 tried 闩会把 onLaunch 首败（分包未就绪）永久锁存——
  // async 面轮询等待分包下载，launch catch-up 不哑火（审查四轮 F7）。
  const bundle = await loadKernelAsync()
  if (bundle === undefined) return []
  const lanes: IoState[] = [localCas]
  if (remoteDurableActive() && hasFreshTicket()) lanes.push(ioStateFor())
  const ran: Awaited<ReturnType<typeof sweepTick>> = []
  for (const st of lanes) {
    const ctx: PumpCtx = { kernel: bundle.kernel, io: { ...ioFor(''), state: st }, owner: 'local', holder: HOLDER }
    ran.push(...await sweepTick(ctx, { batchLimit: 10 }, ioFor))
  }
  // fenced/claim-denied/step-exhausted 算 ran 但恢复未成——pending 不得误清（审查 B5）；
  // ran=[] 无 due 行=无事可恢复，vacuous-true 清标记——否则首次 onHide 后
  // PENDING 永真，每个 tick 白跑一次 sweep（UI 审查 F12）。
  const settled = ran.every((r) => r.outcome === 'completed' || r.outcome === 'suspended')
  // 标记写尽力即可——配额抛会把 tick 变 unhandled rejection 且 PENDING 永真（审查十四轮 L14）。
  if (settled) {
    try { wx.setStorageSync(PENDING_KEY, false) } catch (e) { console.warn('[nano-mini] pending 标记清理失败:', e instanceof Error ? e.message : e); reportSilent(e, { op: 'pending-clear', lane: 'background' }) }
  }
  return ran.map((r) => `${r.sessionId}:${r.outcome}`)
}

export function nanoMiniStartTick(): void {
  if (timer !== undefined) return
  const pending = wx.getStorageSync(PENDING_KEY) as boolean | '' | undefined
  if (pending === true) nanoMiniCatchUp().catch((e) => { console.warn('[nano-mini] pending catchUp failed:', e); reportSilent(e, { op: 'catchUp', lane: 'background' }) })
  timer = setInterval(() => {
    nanoMiniCatchUp().catch((e) => { console.warn('[nano-mini] tick catchUp failed:', e); reportSilent(e, { op: 'tick', lane: 'background' }) })
  }, TICK_MS)
}

export function nanoMiniStopTick(): void {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
  // 标记写尽力即可——onHide 抛配额会把隐藏生命周期变崩溃（审查十四轮 L14）。
  try { wx.setStorageSync(PENDING_KEY, true) } catch (e) { console.warn('[nano-mini] pending 标记置位失败:', e instanceof Error ? e.message : e); reportSilent(e, { op: 'pending-set', lane: 'background' }) }
}
