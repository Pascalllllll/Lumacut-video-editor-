import { create } from 'zustand'

/**
 * Kept apart from the project store: the playhead changes every frame during
 * playback, and only the few components that draw it should re-render.
 */
type PlayheadState = {
  frame: number
  playing: boolean
  /** Playback rate for J/K/L shuttle: negative plays backwards. */
  rate: number
  seek: (frame: number) => void
  setPlaying: (playing: boolean) => void
  shuttle: (rate: number) => void
}

export const usePlayhead = create<PlayheadState>((set) => ({
  frame: 0,
  playing: false,
  rate: 1,
  seek: (frame) => set({ frame: Math.max(0, Math.round(frame)) }),
  setPlaying: (playing) => set(playing ? { playing } : { playing, rate: 1 }),
  shuttle: (rate) => set({ rate, playing: rate !== 0 }),
}))
