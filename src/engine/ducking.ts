import { evaluate, type Animated } from './animation'
import type { Command } from './commands'
import type { Clip, Project, Sequence } from './model'
import { sourceFrameAt } from './speed'
import { fpsValue } from './time'

/** A file's peak levels, 0 to 255, `rate` per second (the waveform cache). */
export type Envelope = { rate: number; peaks: Uint8Array }

export type DuckOptions = {
  /** How far the music drops under speech, in dB (negative). */
  amount: number
  /** Level above which a dialogue clip counts as speaking, in dBFS. */
  threshold: number
  /** Seconds the music takes to go down and come back. */
  ramp: number
}

export const DEFAULT_DUCK: DuckOptions = { amount: -12, threshold: -32, ramp: 0.3 }

/** Where dialogue tracks are speaking, as [start, end) sequence frames, merged across tracks. */
export function speechRanges(
  project: Project,
  seq: Sequence,
  envelopeOf: (mediaId: string) => Envelope | undefined,
  threshold = DEFAULT_DUCK.threshold,
): [number, number][] {
  const fps = fpsValue(seq.fps)
  const level = Math.pow(10, threshold / 20) * 255
  // Short pauses between words don't let the music back up.
  const hold = Math.round(fps * 0.4)
  const ranges: [number, number][] = []
  for (const track of seq.tracks) {
    if (track.kind !== 'audio' || track.role !== 'dialogue' || track.muted) continue
    for (const clip of Object.values(seq.clips)) {
      if (clip.trackId !== track.id) continue
      const asset = project.media[clip.mediaId]
      const env = envelopeOf(clip.mediaId)
      if (!asset?.hasAudio || !env) continue
      let open: number | null = null
      let last = -Infinity
      for (let f = 0; f < clip.duration; f++) {
        const seconds = sourceFrameAt(clip, f) / fps
        const i = Math.floor(seconds * env.rate)
        const loud = (env.peaks[i] ?? 0) > level
        const at = clip.start + f
        if (loud) {
          if (open === null) open = at
          last = at
        } else if (open !== null && at - last > hold) {
          ranges.push([open, last + 1])
          open = null
        }
      }
      if (open !== null) ranges.push([open, last + 1])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const prev = merged[merged.length - 1]
    if (prev && r[0] <= prev[1] + hold) prev[1] = Math.max(prev[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** The clip's volume curve dipped by `amount` dB over each range, with ramps either side. */
export function duckedVolume(
  clip: Clip,
  ranges: [number, number][],
  amount: number,
  rampFrames: number,
): Animated {
  const base = clip.sound.volume.keys.length
    ? evaluate(clip.sound.volume, 0)
    : clip.sound.volume.value
  const local: [number, number][] = []
  for (const [s, e] of ranges) {
    const a = s - clip.start
    const b = e - clip.start
    if (b + rampFrames <= 0 || a - rampFrames >= clip.duration) continue
    const prev = local[local.length - 1]
    // Ranges closer than two ramps stay down between them.
    if (prev && a - rampFrames <= prev[1] + rampFrames) prev[1] = Math.max(prev[1], b)
    else local.push([a, b])
  }
  if (local.length === 0) return { value: base, keys: [] }
  const keys: Animated['keys'] = []
  for (const [a, b] of local) {
    keys.push({ frame: a - rampFrames, value: base, ease: 'ease-in-out' })
    keys.push({ frame: a, value: base + amount, ease: 'linear' })
    keys.push({ frame: b, value: base + amount, ease: 'ease-in-out' })
    keys.push({ frame: b + rampFrames, value: base, ease: 'linear' })
  }
  return { value: base, keys }
}

/** One undoable change that ducks every clip on music tracks under the dialogue. */
export function duckCommand(
  project: Project,
  seq: Sequence,
  envelopeOf: (mediaId: string) => Envelope | undefined,
  options: DuckOptions = DEFAULT_DUCK,
): Command | null {
  const ranges = speechRanges(project, seq, envelopeOf, options.threshold)
  const ramp = Math.max(1, Math.round(fpsValue(seq.fps) * options.ramp))
  const music = new Set(
    seq.tracks
      .filter((t) => t.kind === 'audio' && t.role === 'music' && !t.locked)
      .map((t) => t.id),
  )
  const commands: Command[] = []
  for (const clip of Object.values(seq.clips)) {
    if (!music.has(clip.trackId)) continue
    commands.push({
      type: 'clip.look',
      sequenceId: seq.id,
      clipIds: [clip.id],
      patch: { sound: { ...clip.sound, volume: duckedVolume(clip, ranges, options.amount, ramp) } },
    })
  }
  return commands.length ? { type: 'batch', label: 'Duck music', commands } : null
}
