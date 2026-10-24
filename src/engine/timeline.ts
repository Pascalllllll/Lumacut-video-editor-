import type { Clip, Sequence, Track } from './model'
import { sourceOffsetAt, sourceSpan, trimRamp } from './speed'
import { shiftClipKeys } from './keys'

export function clipEnd(clip: Pick<Clip, 'start' | 'duration'>): number {
  return clip.start + clip.duration
}

export function clipsOnTrack(seq: Sequence, trackId: string): Clip[] {
  return Object.values(seq.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start)
}

export function sequenceDuration(seq: Sequence): number {
  let end = 0
  for (const clip of Object.values(seq.clips)) end = Math.max(end, clipEnd(clip))
  return end
}

export function clipAt(seq: Sequence, trackId: string, frame: number): Clip | undefined {
  for (const c of Object.values(seq.clips)) {
    if (c.trackId === trackId && frame >= c.start && frame < clipEnd(c)) return c
  }
  return undefined
}

export function trackOf(seq: Sequence, trackId: string): Track | undefined {
  return seq.tracks.find((t) => t.id === trackId)
}

/** The magnetic storyline: the first video track. */
export function primaryTrack(seq: Sequence): Track | undefined {
  return seq.tracks.find((t) => t.kind === 'video')
}

export function videoTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === 'video')
}

export function audioTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === 'audio')
}

/**
 * The part of a clip between timeline offsets `from` and `to` (relative to the
 * clip start), as a clip of its own. Handles speed, ramps and reverse, so every
 * cut, trim and overwrite agrees on which source frames remain.
 */
export function portion(clip: Clip, from: number, to: number): Clip {
  const duration = to - from
  let sourceIn = clip.sourceIn
  const frozen = !clip.ramp && clip.speed === 0
  if (!frozen) {
    if (clip.reverse)
      sourceIn =
        clip.sourceIn + Math.max(0, sourceSpan(clip) - Math.round(sourceOffsetAt(clip, to)))
    else sourceIn = clip.sourceIn + Math.round(sourceOffsetAt(clip, from))
  }
  const cut = {
    ...clip,
    start: clip.start + from,
    duration,
    sourceIn,
    ramp: trimRamp(clip.ramp, from, duration),
    sound: {
      ...clip.sound,
      fadeIn: Math.min(clip.sound.fadeIn, duration),
      fadeOut: Math.min(clip.sound.fadeOut, duration),
    },
  }
  // Keyframes count from the clip start, so they move back by what was cut off.
  return from === 0 ? cut : shiftClipKeys(cut, from)
}

function assign(target: Clip, next: Clip) {
  target.start = next.start
  target.duration = next.duration
  target.sourceIn = next.sourceIn
  target.ramp = next.ramp
  target.transform = next.transform
  target.effects = next.effects
  target.masks = next.masks
  target.sound = next.sound
}

/**
 * Makes room for an overwrite on [start, end): clips fully inside are removed,
 * clips crossing an edge are trimmed, and a clip spanning the whole range is
 * split in two. `nextSplitId` names the right half after the clip being split,
 * so the result is the same every time the command runs.
 */
export function clearRange(
  seq: Sequence,
  trackId: string,
  start: number,
  end: number,
  ignoreIds: ReadonlySet<string>,
  nextSplitId: (splitClipId: string) => string,
): void {
  for (const clip of Object.values(seq.clips)) {
    if (clip.trackId !== trackId || ignoreIds.has(clip.id)) continue
    const cEnd = clipEnd(clip)
    if (cEnd <= start || clip.start >= end) continue

    if (clip.start >= start && cEnd <= end) {
      delete seq.clips[clip.id]
    } else if (clip.start < start && cEnd > end) {
      const rightId = nextSplitId(clip.id)
      seq.clips[rightId] = { ...portion(clip, end - clip.start, clip.duration), id: rightId }
      assign(clip, portion(clip, 0, start - clip.start))
    } else if (clip.start < start) {
      assign(clip, portion(clip, 0, start - clip.start))
    } else {
      assign(clip, portion(clip, end - clip.start, clip.duration))
    }
  }
}

/**
 * Moves everything at or after `at` on the given tracks by `delta` frames.
 * With a positive delta (an insert), a clip crossing `at` is split first so
 * its right part moves; `nextSplitId` names that part.
 */
export function shiftFrom(
  seq: Sequence,
  trackIds: ReadonlySet<string>,
  at: number,
  delta: number,
  nextSplitId: (splitClipId: string) => string,
) {
  if (delta === 0) return
  for (const clip of Object.values(seq.clips)) {
    if (!trackIds.has(clip.trackId)) continue
    if (delta > 0 && clip.start < at && clipEnd(clip) > at) {
      const rightId = nextSplitId(clip.id)
      seq.clips[rightId] = { ...portion(clip, at - clip.start, clip.duration), id: rightId }
      assign(clip, portion(clip, 0, at - clip.start))
    }
  }
  for (const clip of Object.values(seq.clips)) {
    if (trackIds.has(clip.trackId) && clip.start >= at) clip.start = Math.max(0, clip.start + delta)
  }
  for (const marker of Object.values(seq.markers)) {
    if (marker.frame >= at) marker.frame = Math.max(0, marker.frame + delta)
  }
}

/** Clip ids that move together with the given ones (linked audio/video and groups). */
export function companions(seq: Sequence, ids: Iterable<string>): Set<string> {
  const result = new Set<string>()
  const links = new Set<string>()
  const groups = new Set<string>()
  for (const id of ids) {
    const c = seq.clips[id]
    if (!c) continue
    result.add(id)
    if (c.linkId) links.add(c.linkId)
    if (c.groupId) groups.add(c.groupId)
  }
  for (const c of Object.values(seq.clips)) {
    if ((c.linkId && links.has(c.linkId)) || (c.groupId && groups.has(c.groupId))) result.add(c.id)
  }
  return result
}

/**
 * Magnetic mode: closes every gap on the primary track. Clips on other tracks
 * that are linked to a primary clip move by the same amount, so connected
 * audio stays in sync.
 */
export function closeGaps(seq: Sequence) {
  const primary = primaryTrack(seq)
  if (!primary) return
  let cursor = 0
  for (const clip of clipsOnTrack(seq, primary.id)) {
    const delta = cursor - clip.start
    if (delta !== 0) {
      for (const other of Object.values(seq.clips)) {
        if (
          other.id !== clip.id &&
          clip.linkId &&
          other.linkId === clip.linkId &&
          other.trackId !== primary.id
        ) {
          other.start = Math.max(0, other.start + delta)
        }
      }
      clip.start = cursor
    }
    cursor = clipEnd(clip)
  }
}

/** Nearest boundary between primary-track clips, for magnetic inserts. */
export function nearestBoundary(
  seq: Sequence,
  frame: number,
  ignoreIds: ReadonlySet<string> = new Set(),
): number {
  const primary = primaryTrack(seq)
  if (!primary) return 0
  let best = 0
  let bestDist = Infinity
  let cursor = 0
  const points = [0]
  for (const clip of clipsOnTrack(seq, primary.id)) {
    if (ignoreIds.has(clip.id)) continue
    cursor += clip.duration
    points.push(cursor)
  }
  for (const p of points) {
    const d = Math.abs(p - frame)
    if (d < bestDist) {
      best = p
      bestDist = d
    }
  }
  return best
}

/** Sequences reachable by nesting from `seqId`, including itself. Used to refuse cycles. */
export function nestedSequenceIds(
  sequences: Record<string, Sequence>,
  media: Record<string, { kind: string; sequenceId: string | null }>,
  seqId: string,
  seen = new Set<string>(),
): Set<string> {
  if (seen.has(seqId)) return seen
  seen.add(seqId)
  const seq = sequences[seqId]
  if (!seq) return seen
  for (const clip of Object.values(seq.clips)) {
    const asset = media[clip.mediaId]
    if (asset?.kind === 'sequence' && asset.sequenceId)
      nestedSequenceIds(sequences, media, asset.sequenceId, seen)
  }
  return seen
}
