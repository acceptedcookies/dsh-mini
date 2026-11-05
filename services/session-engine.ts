/**
 * session-engine —— 会话引擎选择的单一真源（业主 MN03 裁决）。
 *
 * 三条车道语义：
 *   nano-agent = 本地 kernel 泵 + io.llm BYOK 代理（票据车道）——默认本地引擎，
 *                打包后真机唯一可见的本地选项（用户自己的 BYOK）。
 *   magpie     = 本地 kernel 泵 + io.llm 直连本机 magpie 网关（127.0.0.1:3425）
 *                ——开发指针 `.dev-magpie` 在位才出现的测试选项，纯本地车道
 *                （io.state localCas、转录不上行、图片 data: 内联、不铸票）。
 *   cloud      = nanoRuntime 远端执行——未适配，菜单仅显示不可选。
 *
 * 选择真源：storage `dsh:mini:engine:v1`（pendingEngine）——用户最近一次选择，
 * 持久跨启动；kernel create() 建会话时烙 summary.engine，之后该会话一切车道
 * 判定只认戳记（engineForSession），全局路由旋钮只兜无戳旧会话的底。
 */
import { storage } from './storage'
import { loadDevConfig, currentRoute } from './fx/dev'
import type { SessionEngine } from '../types/protocol'

const PENDING_KEY = 'dsh:mini:engine:v1'

/** magpie 选项可见闸：dev-config 烘入指针 flag（仓库根 `.dev-magpie` →
 *  fx-dev-config.mjs）且非 release 包且宿主是开发者工具——三闸保证真机
 *  （调试包同理）只见 BYOK：真机上 127.0.0.1 指向手机自身，本机 magpie
 *  网关不存在，选项出现必然误导（业主 MN04）。 */
export function magpieAvailable(): boolean {
  if (loadDevConfig()?.magpieDev !== true) return false
  try {
    if (wx.getAccountInfoSync().miniProgram.envVersion === 'release') return false
  } catch {
    /* envVersion 读不到的 dev 环境不误杀 */
  }
  try {
    return wx.getDeviceInfo().platform === 'devtools'
  } catch {
    return true // 平台不可知（老基础库/Node harness）时不误杀
  }
}

/** 路由兜底引擎：无戳记旧会话与 pending 未选时的派生面。
 *  local 路由恒 magpie——「直连上游」是 local 路由自身语义，与菜单指针无关
 *  （无指针时只是 UI 不展示该选项，车道语义不变）；cloudish→nano-agent。 */
export function routeDefaultEngine(): SessionEngine {
  return currentRoute().mode === 'local' ? 'magpie' : 'nano-agent'
}

function isEngine(v: unknown): v is SessionEngine {
  return v === 'nano-agent' || v === 'magpie' || v === 'cloud'
}

/** 下一次建会话将使用的引擎（菜单勾选态同值）。能力面失效的持久化值
 *  如实回退——指针消失后旧 magpie 选择不得幽灵存活。 */
export function pendingEngine(): SessionEngine {
  const v = wx.getStorageSync(PENDING_KEY) as string | '' | undefined
  if (v === 'magpie' && !magpieAvailable()) return 'nano-agent'
  if (v === 'cloud') return 'nano-agent' // 未适配——落回本地默认
  return isEngine(v) ? v : routeDefaultEngine()
}

export function setPendingEngine(engine: SessionEngine): void {
  try {
    wx.setStorageSync(PENDING_KEY, engine)
  } catch (e) {
    console.warn('[session-engine] pending 写失败:', e instanceof Error ? e.message : e)
  }
}

/** 会话的生效引擎：summary.engine 戳记优先；旧会话无戳→路由兜底（=建时
 *  全局语义，行为不变）。sid='' / 未命中亦回落兜底（tick ctx 用）。 */
export function engineForSession(sessionId: string): SessionEngine {
  const rows = storage.getSessions<{ summary: { id: string; engine?: string } }>() ?? []
  const e = rows.find((r) => r.summary?.id === sessionId)?.summary?.engine
  return isEngine(e) ? e : routeDefaultEngine()
}

/** 菜单/提示用全称。 */
export function engineLabel(engine: SessionEngine): string {
  return engine === 'cloud' ? '云端引擎' : `本地引擎 · ${engine}`
}

/** 引擎短名（业主 MN05）：nano-agent 简写 nano。 */
export function engineBadgeShort(engine: SessionEngine): string {
  return engine === 'cloud' ? '云端' : engine === 'nano-agent' ? 'nano' : engine
}

/** 会话行紧凑徽标：本地·nano / 本地·magpie / 云端·nano（云端内核=nano-agent）。 */
export function engineBadge(engine: SessionEngine): string {
  return engine === 'cloud' ? '云端·nano' : `本地·${engineBadgeShort(engine)}`
}
