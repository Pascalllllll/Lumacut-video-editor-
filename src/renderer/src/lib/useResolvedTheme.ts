import { useSyncExternalStore } from 'react'
import type { Theme } from '@shared/settings'

const query = window.matchMedia('(prefers-color-scheme: dark)')

function subscribe(callback: () => void) {
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

export function useResolvedTheme(theme: Theme): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(subscribe, () => query.matches)
  if (theme === 'auto') return systemDark ? 'dark' : 'light'
  return theme
}
