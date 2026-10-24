import type { LumacutApi } from './index'

declare global {
  interface Window {
    lumacut: LumacutApi
  }
}

export {}
