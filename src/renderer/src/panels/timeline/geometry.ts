import type { Sequence, Track } from '@engine/model'

export const HEADER_W = 132
export const RULER_H = 28
export const SNAP_PX = 8
export const EDGE_PX = 6
export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 40
export const DEFAULT_HEIGHT: Record<Track['kind'], number> = { video: 60, audio: 48 }

export function trackHeight(track: Track): number {
  return track.height ?? DEFAULT_HEIGHT[track.kind]
}

/** Display order: video tracks top-down from the highest, then audio tracks in order. */
export function displayTracks(seq: Sequence): Track[] {
  const videos = seq.tracks.filter((t) => t.kind === 'video').reverse()
  const audios = seq.tracks.filter((t) => t.kind === 'audio')
  return [...videos, ...audios]
}

export function snap(
  frame: number,
  points: number[],
  pxPerFrame: number,
  enabled: boolean,
): number {
  if (!enabled) return frame
  let best = frame
  let bestDist = SNAP_PX / pxPerFrame
  for (const p of points) {
    const d = Math.abs(p - frame)
    if (d < bestDist) {
      best = p
      bestDist = d
    }
  }
  return best
}
