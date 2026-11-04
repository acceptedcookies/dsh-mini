import { storage } from './storage'

export type Theme = 'light' | 'dark'

let current: Theme | undefined

export function systemTheme(): Theme {
  const info = wx.getSystemInfoSync()
  return info.theme === 'dark' ? 'dark' : 'light'
}

export function getTheme(): Theme {
  if (current !== undefined) return current
  current = storage.getTheme() ?? systemTheme()
  return current
}

export function setTheme(theme: Theme): void {
  current = theme
  storage.setTheme(theme)
  applyNavigationBar(theme)
}

export function useSystemTheme(): Theme {
  storage.clearTheme()
  current = systemTheme()
  applyNavigationBar(current)
  return current
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

export type NavigationSurface = 'base' | 'layer-2'

export function applyNavigationBar(theme: Theme, surface: NavigationSurface = 'base'): void {
  wx.setNavigationBarColor({
    frontColor: theme === 'dark' ? '#ffffff' : '#000000',
    backgroundColor: surface === 'layer-2'
      ? (theme === 'dark' ? '#2c2c2e' : '#ffffff')
      : (theme === 'dark' ? '#151517' : '#ffffff'),
    animation: { duration: 120, timingFunc: 'easeIn' },
  })
}

export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  const handler = (event: WechatMiniprogram.OnThemeChangeListenerResult): void => {
    if (storage.getTheme() === undefined) {
      current = event.theme
      applyNavigationBar(event.theme)
      onChange(event.theme)
    }
  }
  wx.onThemeChange(handler)
  return () => wx.offThemeChange(handler)
}
