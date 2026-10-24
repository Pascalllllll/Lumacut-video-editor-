import { create } from 'zustand'

export type ModelState = {
  ready: boolean
  bytes: number
  /** 0 to 1 while downloading, null otherwise. */
  progress: number | null
  error: string | null
}

type ModelsStore = {
  models: Record<string, ModelState>
  refresh: () => Promise<void>
}

/** Which local models are on disk, kept in step with download progress from the main process. */
export const useModels = create<ModelsStore>((set) => ({
  models: {},
  refresh: async () => {
    const list = await window.lumacut.invoke('models:list')
    set((s) => ({
      models: Object.fromEntries(
        list.map((m) => [
          m.id,
          {
            ready: m.ready,
            bytes: m.bytes,
            progress: m.downloading ? (s.models[m.id]?.progress ?? 0) : null,
            error: s.models[m.id]?.error ?? null,
          },
        ]),
      ),
    }))
  },
}))

let listening = false
/** Starts following download progress; safe to call more than once. */
export function watchModels() {
  if (listening) return
  listening = true
  void useModels.getState().refresh()
  window.lumacut.on('models:progress', (u) => {
    useModels.setState((s) => {
      const prev = s.models[u.id] ?? { ready: false, bytes: 0, progress: null, error: null }
      const next: ModelState =
        u.state === 'running'
          ? { ...prev, progress: u.fraction, error: null }
          : u.state === 'done'
            ? { ...prev, ready: true, progress: null, error: null }
            : { ...prev, progress: null, error: u.state === 'failed' ? (u.message ?? null) : null }
      return { models: { ...s.models, [u.id]: next } }
    })
  })
}

export const isModelReady = (id: string) => useModels.getState().models[id]?.ready ?? false
