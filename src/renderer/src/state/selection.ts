import { create } from 'zustand'

/** Media items picked in the media list; the last one picked is shown in the inspector. */
export const useSelectedMedia = create<{ mediaIds: string[]; mediaId: string | null }>(() => ({
  mediaIds: [],
  mediaId: null,
}))

export function selectMedia(id: string, mode: 'replace' | 'toggle' = 'replace') {
  const { mediaIds } = useSelectedMedia.getState()
  if (mode === 'toggle') {
    const next = mediaIds.includes(id) ? mediaIds.filter((m) => m !== id) : [...mediaIds, id]
    useSelectedMedia.setState({ mediaIds: next, mediaId: next.at(-1) ?? null })
  } else {
    useSelectedMedia.setState({ mediaIds: [id], mediaId: id })
  }
}
