/**
 * engine.ts — MS01 皮肤引擎（T-O-4 / T-O-6 / T-O-10）
 *
 * 单一职责：
 *  - mode 解析唯一持有（resolveMode / watchMode）
 *  - resolved[eff] 单一状态（tokens/eff getter）
 *  - appStyle 唯一生产者（composeAppStyle = skin 段 + metrics 段）
 *  - chrome 唯一应用点（applyChrome → setNavigationBarColor + setBackgroundColor）
 *  - 皮肤入口闸（applySkin：dsh-default 快径；其余 validate 先决）
 */
import { VOCAB, type VocabToken } from './vocab'
import { validate, type SkinJson, type ValidationError, type VocabLike } from './validate'
import { storage } from '../storage'
import type { WindowMetrics } from '../../utils/window'

export type SkinMode = 'light' | 'dark'
export type ThemePref = SkinMode | 'system'

type TokenMap = Record<string, string>

interface ChromeValues {
  navBackground: string
  navFront: string
  pullBackground: string
}

interface EngineState {
  pref: ThemePref
  eff: SkinMode
  tokens: TokenMap
  chrome: ChromeValues
  skin: SkinJson | null
}

const VOCAB_LIKE = VOCAB as unknown as VocabLike
const TOKEN_ENTRIES = Object.entries(VOCAB.tokens) as Array<[string, VocabToken]>

function defaultsFor(mode: SkinMode): TokenMap {
  const out: TokenMap = {}
  for (const [key, entry] of TOKEN_ENTRIES) out[key] = mode === 'light' ? entry.light : entry.dark
  for (const surface of Object.values(VOCAB.surfaces)) out[surface.emits] = surface.default
  return out
}

function defaultsChrome(mode: SkinMode): ChromeValues {
  return {
    navBackground: VOCAB.chrome.navBackground[mode],
    navFront: VOCAB.chrome.navFront[mode],
    pullBackground: VOCAB.chrome.pullBackground[mode],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** defaults[eff] ⊕ skin[eff]（逐键 merge；surface 键经 emits sanitize）。 */
function resolveTokens(mode: SkinMode, skin: SkinJson | null): TokenMap {
  const out = defaultsFor(mode)
  if (skin === null) return out
  const block = skin[mode]
  if (!isRecord(block)) return out
  for (const family of ['palette', 'shape', 'spacing', 'typography', 'elevation', 'effects']) {
    const familyBlock = block[family]
    if (!isRecord(familyBlock)) continue
    for (const [key, value] of Object.entries(familyBlock)) {
      if (typeof value !== 'string') continue
      if (key in out) out[key] = value
    }
  }
  const surfaces = block.surfaces
  if (isRecord(surfaces)) {
    for (const [key, value] of Object.entries(surfaces)) {
      if (typeof value !== 'string') continue
      const surface = VOCAB.surfaces[key]
      if (surface !== undefined) out[surface.emits] = value
    }
  }
  return out
}

function resolveChrome(mode: SkinMode, skin: SkinJson | null): ChromeValues {
  const out = defaultsChrome(mode)
  if (skin === null) return out
  const block = skin[mode]
  if (!isRecord(block) || !isRecord(block.chrome)) return out
  for (const key of ['navBackground', 'navFront', 'pullBackground'] as const) {
    const value = block.chrome[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/** 系统轨当前值（pref='system' 时唯一读取点）。 */
function systemMode(): SkinMode {
  try {
    const info = wx.getSystemInfoSync()
    return info.theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveMode(pref: ThemePref, _skin?: SkinJson | null): SkinMode {
  if (pref === 'system') return systemMode()
  return pref
}

const listeners = new Set<(eff: SkinMode) => void>()
let themeHandlerAttached = false

const state: EngineState = {
  pref: 'system',
  eff: 'light',
  tokens: defaultsFor('light'),
  chrome: defaultsChrome('light'),
  skin: null,
}

function recompute(): void {
  state.eff = resolveMode(state.pref, state.skin)
  state.tokens = resolveTokens(state.eff, state.skin)
  state.chrome = resolveChrome(state.eff, state.skin)
}

function notify(): void {
  for (const cb of listeners) cb(state.eff)
}

/** 启动同步：vocab import 即得 defaults；pref 从 storage 恢复（dsh:theme:v2 不动）。 */
export function init(): SkinMode {
  state.pref = storage.getTheme() ?? 'system'
  state.skin = null
  recompute()
  return state.eff
}

/** appStyle 唯一生产者：skin 段（resolved 全键）+ metrics 段。 */
export function composeAppStyle(metricsVars: string[]): string {
  const skinVars = Object.entries(state.tokens).map(([key, value]) => `${key}: ${value}`)
  return [...skinVars, ...metricsVars].join('; ')
}

/** 订阅 mode/skin 变化；pref='system' 时内挂 wx.onThemeChange。 */
export function watchMode(cb: (eff: SkinMode) => void): () => void {
  listeners.add(cb)
  if (!themeHandlerAttached) {
    themeHandlerAttached = true
    try {
      wx.onThemeChange((event: WechatMiniprogram.OnThemeChangeListenerResult) => {
        if (storage.getTheme() === undefined) {
          state.pref = 'system'
          state.eff = event.theme === 'dark' ? 'dark' : 'light'
          state.tokens = resolveTokens(state.eff, state.skin)
          state.chrome = resolveChrome(state.eff, state.skin)
          notify()
        }
      })
    } catch {
      // 运行时无 onThemeChange（旧基础库/Node）——降级为不监听
    }
  }
  return () => { listeners.delete(cb) }
}

/** 原生外壳：nav 色取 resolved bg-base/bg-layer-2；page 底走 setBackgroundColor（E6-2）。 */
export function applyChrome(eff: SkinMode, surface: 'base' | 'layer-2' = 'base'): void {
  const chrome = state.eff === eff ? state.chrome : resolveChrome(eff, state.skin)
  const tokens = state.eff === eff ? state.tokens : resolveTokens(eff, state.skin)
  const background = surface === 'layer-2'
    ? (tokens['--dsw-alias-bg-layer-2'] ?? defaultsFor(eff)['--dsw-alias-bg-layer-2'])
    : (tokens['--dsw-alias-bg-base'] ?? defaultsFor(eff)['--dsw-alias-bg-base'])
  try {
    wx.setNavigationBarColor({
      frontColor: chrome.navFront,
      backgroundColor: background,
      animation: { duration: 120, timingFunc: 'easeIn' },
    })
    wx.setBackgroundColor({
      backgroundColor: chrome.pullBackground,
      backgroundColorTop: chrome.pullBackground,
      backgroundColorBottom: chrome.pullBackground,
    })
  } catch {
    // Node 短验/旧基础库无该 API——静默降级，不影响 resolved 状态
  }
}

export class SkinValidationError extends Error {
  errors: ValidationError[]
  constructor(errors: ValidationError[]) {
    super(`skin invalid: ${errors.map((e) => `${e.path}(${e.rule})`).join(', ')}`)
    this.name = 'SkinValidationError'
    this.errors = errors
  }
}

/** 皮肤入口：dsh-default 快径；其余必须先过 validate（fail-closed）。 */
export function applySkin(skin: SkinJson | null): { ok: true; eff: SkinMode } {
  if (skin === null || skin.slug === 'dsh-default') {
    state.skin = null
    recompute()
    notify()
    return { ok: true, eff: state.eff }
  }
  const result = validate(skin, VOCAB_LIKE)
  if (!result.ok) throw new SkinValidationError(result.errors)
  state.skin = skin
  recompute()
  notify()
  return { ok: true, eff: state.eff }
}

/** pref 写路径（settings 三档）：storage 由调用方写，engine 负责任 re-resolve + 通知。 */
export function setPref(pref: ThemePref): SkinMode {
  state.pref = pref
  recompute()
  notify()
  return state.eff
}

export function buildMetricsVars(metrics: WindowMetrics): string[] {
  return [
    `--app-status-bar: ${metrics.statusBarHeight}px`,
    `--app-nav-height: ${metrics.statusBarHeight + metrics.navBarContentHeight}px`,
    `--app-capsule-right: ${metrics.capsuleInsetRight}px`,
    `--app-safe-bottom: ${metrics.safeAreaBottom}px`,
  ]
}

export const engine = {
  init,
  resolveMode,
  composeAppStyle,
  watchMode,
  applyChrome,
  applySkin,
  setPref,
  buildMetricsVars,
  get tokens(): Readonly<TokenMap> { return state.tokens },
  get eff(): SkinMode { return state.eff },
  get skin(): SkinJson | null { return state.skin },
}
