import type { Rational } from './model'

export function fpsValue(fps: Rational): number {
  return fps.num / fps.den
}

export function framesToSeconds(frames: number, fps: Rational): number {
  return (frames * fps.den) / fps.num
}

/** Rounds to the nearest frame. */
export function secondsToFrames(seconds: number, fps: Rational): number {
  return Math.round((seconds * fps.num) / fps.den)
}

/** Whole frames that fit in a duration; a partial last frame is dropped. */
export function secondsToWholeFrames(seconds: number, fps: Rational): number {
  return Math.floor((seconds * fps.num) / fps.den + 1e-6)
}

/** SMPTE-style timecode HH:MM:SS:FF. Non-drop-frame, counted on the rounded rate. */
export function formatTimecode(frames: number, fps: Rational): string {
  const base = Math.round(fpsValue(fps))
  const sign = frames < 0 ? '-' : ''
  let f = Math.abs(Math.round(frames))
  const ff = f % base
  f = Math.floor(f / base)
  const ss = f % 60
  f = Math.floor(f / 60)
  const mm = f % 60
  const hh = Math.floor(f / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

/** Pick the closest common frame rate to a measured one, e.g. 29.97002 -> 30000/1001. */
export function normalizeFps(value: number): Rational {
  const common: Rational[] = [
    { num: 24000, den: 1001 },
    { num: 24, den: 1 },
    { num: 25, den: 1 },
    { num: 30000, den: 1001 },
    { num: 30, den: 1 },
    { num: 48, den: 1 },
    { num: 50, den: 1 },
    { num: 60000, den: 1001 },
    { num: 60, den: 1 },
    { num: 120, den: 1 },
  ]
  for (const r of common) if (Math.abs(fpsValue(r) - value) < 0.01) return r
  return { num: Math.max(1, Math.round(value * 1000)), den: 1000 }
}
