import { create } from 'zustand'

export type Notice = { id: number; kind: 'error' | 'info'; message: string }

type NoticeState = { notices: Notice[]; dismiss: (id: number) => void }

let nextId = 1

export const useNotices = create<NoticeState>((set) => ({
  notices: [],
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}))

export function notify(kind: Notice['kind'], message: string) {
  const id = nextId++
  useNotices.setState((s) => ({ notices: [...s.notices.slice(-3), { id, kind, message }] }))
  if (kind === 'info') setTimeout(() => useNotices.getState().dismiss(id), 5000)
}
