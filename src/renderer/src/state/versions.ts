import { create } from 'zustand'

/** The "restore an earlier version" sheet; `recovery` when shown after a crash. */
export const useVersions = create<{ open: boolean; recovery: boolean }>(() => ({
  open: false,
  recovery: false,
}))
