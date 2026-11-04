export interface CapsuleRect {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export interface WindowMetrics {
  width: number
  height: number
  statusBarHeight: number
  safeAreaBottom: number
  /** Height of the custom navigation row, from the status bar to the capsule bottom. */
  navBarContentHeight: number
  /** Space the native capsule occupies at the top-right, including its right margin. */
  capsuleInsetRight: number
  capsule: CapsuleRect | undefined
}

const FALLBACK_NAV_CONTENT_HEIGHT = 44
const FALLBACK_CAPSULE_INSET = 96

function readCapsule(): CapsuleRect | undefined {
  try {
    const rect = wx.getMenuButtonBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      }
    }
  } catch {
    // Some simulator/base-library combinations do not expose the capsule rect.
  }
  return undefined
}

export function getWindowMetrics(): WindowMetrics {
  const info = wx.getWindowInfo()
  const statusBarHeight = info.statusBarHeight ?? 0
  const safeArea = info.safeArea
  const capsule = readCapsule()
  const capsuleGap = capsule === undefined ? 4 : Math.max(4, capsule.top - statusBarHeight)
  const navBarContentHeight = capsule === undefined
    ? FALLBACK_NAV_CONTENT_HEIGHT
    : capsule.height + capsuleGap * 2
  const capsuleInsetRight = capsule === undefined
    ? FALLBACK_CAPSULE_INSET
    : Math.max(8, info.windowWidth - capsule.left + 8)
  return {
    width: info.windowWidth,
    height: info.windowHeight,
    statusBarHeight,
    safeAreaBottom: safeArea === undefined ? 0 : Math.max(0, info.screenHeight - safeArea.bottom),
    navBarContentHeight,
    capsuleInsetRight,
    capsule,
  }
}

export function getStatusBarHeight(): number {
  return getWindowMetrics().statusBarHeight
}

export function isWideLayout(width = getWindowMetrics().width): boolean {
  return width >= 768
}

export function isDesktopLayout(width = getWindowMetrics().width): boolean {
  return width >= 1024
}
