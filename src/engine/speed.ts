import type { Clip, SpeedPoint } from './model'

/** Speed at a frame offset inside the clip. */
export function speedAt(clip: Pick<Clip, 'speed' | 'ramp'>, t: number): number {
  const ramp = clip.ramp
  if (!ramp) return clip.speed
  if (t <= ramp[0]!.at) return ramp[0]!.speed
  for (let i = 1; i < ramp.length; i++) {
    const a = ramp[i - 1]!
    const b = ramp[i]!
    if (t <= b.at) {
      const k = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at)
      return a.speed + (b.speed - a.speed) * k
    }
  }
  return ramp[ramp.length - 1]!.speed
}

/** Source frames consumed between the clip start and offset t (area under the speed curve). */
export function sourceOffsetAt(clip: Pick<Clip, 'speed' | 'ramp'>, t: number): number {
  const ramp = clip.ramp
  if (!ramp) return t * clip.speed
  let area = 0
  let prevAt = 0
  let prevSpeed = speedAt(clip, 0)
  for (const p of ramp) {
    if (p.at <= 0) continue
    const end = Math.min(p.at, t)
    if (end <= prevAt) break
    const s = speedAt(clip, end)
    area += ((prevSpeed + s) / 2) * (end - prevAt)
    prevAt = end
    prevSpeed = s
    if (end === t) return area
  }
  if (t > prevAt) area += prevSpeed * (t - prevAt)
  return area
}

/** How many source frames the clip uses. A freeze frame uses one. */
export function sourceSpan(clip: Pick<Clip, 'speed' | 'ramp' | 'duration'>): number {
  if (!clip.ramp && clip.speed === 0) return 1
  return Math.max(1, Math.round(sourceOffsetAt(clip, clip.duration)))
}

/** Source frame (fractional) shown at timeline offset t, counting from the start of the media. */
export function sourceFrameAt(
  clip: Pick<Clip, 'speed' | 'ramp' | 'reverse' | 'sourceIn' | 'duration'>,
  t: number,
): number {
  if (!clip.ramp && clip.speed === 0) return clip.sourceIn
  const offset = sourceOffsetAt(clip, t)
  if (!clip.reverse) return clip.sourceIn + offset
  return clip.sourceIn + Math.max(0, sourceSpan(clip) - 1 - offset)
}

/** Ramp points after trimming `cut` frames off the start and setting a new duration. */
export function trimRamp(
  ramp: SpeedPoint[] | null,
  cut: number,
  duration: number,
): SpeedPoint[] | null {
  if (!ramp) return null
  const probe = { speed: 1, ramp }
  const inside = ramp
    .map((p) => ({ at: p.at - cut, speed: p.speed }))
    .filter((p) => p.at > 0 && p.at < duration)
  return [
    { at: 0, speed: speedAt(probe, cut) },
    ...inside,
    { at: duration, speed: speedAt(probe, cut + duration) },
  ]
}

/** Stretches ramp point positions when a clip's duration changes but its shape should stay. */
export function scaleRamp(
  ramp: SpeedPoint[] | null,
  from: number,
  to: number,
): SpeedPoint[] | null {
  if (!ramp || from <= 0) return ramp
  const k = to / from
  return ramp.map((p) => ({ at: p.at * k, speed: p.speed / k }))
}

/** The clip's average speed, used for one-number displays and for element playback rates. */
export function averageSpeed(clip: Pick<Clip, 'speed' | 'ramp' | 'duration'>): number {
  if (!clip.ramp) return clip.speed
  return sourceOffsetAt(clip, clip.duration) / clip.duration
}
