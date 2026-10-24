import { create } from 'zustand'
import type { ReleaseNotes, UpdateStatus } from '@shared/updates'

type UpdatesState = {
  status: UpdateStatus
  notes: ReleaseNotes | null
  /** The What's new sheet, opened on the first start of a new version or from the menu. */
  whatsNew: boolean
}

export const useUpdates = create<UpdatesState>(() => ({
  status: { state: 'idle' },
  notes: null,
  whatsNew: false,
}))

let started = false

/** Follows the main process's update checks and loads this version's notes. */
export function startUpdates() {
  if (started) return
  started = true
  window.lumacut.on('update:status', (status) => useUpdates.setState({ status }))
  void window.lumacut.invoke('update:status').then((status) => useUpdates.setState({ status }))
  void window.lumacut.invoke('app:release-notes').then((notes) => useUpdates.setState({ notes }))
}

export async function checkForUpdates() {
  useUpdates.setState({ status: { state: 'checking' } })
  useUpdates.setState({ status: await window.lumacut.invoke('update:check') })
}
