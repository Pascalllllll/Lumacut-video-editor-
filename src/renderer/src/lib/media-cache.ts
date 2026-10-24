import { useEffect, useState } from 'react'
import type { MediaAsset } from '@engine/model'
import { thumbUrl } from './media-url'

const thumbs = new Map<string, Promise<string | null>>()
const waves = new Map<string, Promise<{ rate: number; peaks: Uint8Array }>>()

function loadThumb(asset: MediaAsset): Promise<string | null> {
  let pending = thumbs.get(asset.path)
  if (!pending) {
    pending = window.lumacut
      .invoke('media:thumbnail', { path: asset.path, kind: asset.kind, duration: asset.duration })
      .then((r) => (r.name ? thumbUrl(r.name) : null))
      .catch(() => null)
    thumbs.set(asset.path, pending)
  }
  return pending
}

export function useThumbnail(asset: MediaAsset | undefined): string | null | undefined {
  const [url, setUrl] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!asset || asset.kind === 'audio') return
    let live = true
    void loadThumb(asset).then((u) => {
      if (live) setUrl({ path: asset.path, url: u })
    })
    return () => {
      live = false
    }
  }, [asset])
  if (!asset || asset.kind === 'audio') return null
  // undefined while loading
  return url?.path === asset.path ? url.url : undefined
}

/** A file's waveform peaks, loaded once and shared. */
export function loadWave(path: string) {
  let pending = waves.get(path)
  if (!pending) {
    pending = window.lumacut.invoke('media:waveform', { path }).then((r) => ({
      rate: r.rate,
      peaks: Uint8Array.from(atob(r.peaks), (c) => c.charCodeAt(0)),
    }))
    pending.catch(() => waves.delete(path))
    waves.set(path, pending)
  }
  return pending
}

export function useWaveform(asset: MediaAsset | undefined) {
  const [data, setData] = useState<{ path: string; rate: number; peaks: Uint8Array } | null>(null)
  useEffect(() => {
    if (!asset?.hasAudio) return
    let live = true
    loadWave(asset.path)
      .then((w) => {
        if (live) setData({ path: asset.path, ...w })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [asset])
  return data && asset && data.path === asset.path ? data : null
}
