import { create } from 'zustand'
import { defaultSettings, type Settings } from '@shared/settings'

type SettingsState = {
  settings: Settings
  loaded: boolean
  saveError: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  saveError: false,
  load: async () => {
    const settings = await window.lumacut.invoke('settings:get')
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    // Apply locally first so the UI responds at once; persistence follows.
    set({ settings: { ...get().settings, ...patch } })
    try {
      const saved = await window.lumacut.invoke('settings:set', patch)
      set({ settings: saved, saveError: false })
    } catch {
      set({ saveError: true })
    }
  },
}))
